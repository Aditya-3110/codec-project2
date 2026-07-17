const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// SIMULATED DATABASE (DynamoDB Simulator)
// ==========================================
const dynamoDB = {
  tables: {
    'chat-connections': new Map(), // connectionId -> { connectionId, username, avatar, connectedAt }
    'chat-messages': [],           // list of messages: { messageId, roomId, username, avatar, content, timestamp }
    'chat-channels': new Map([     // roomId -> { roomId, roomName, inviteCode, createdBy, createdAt }
      ['general', { roomId: 'general', roomName: 'general', inviteCode: 'GENRAL', createdBy: 'SYSTEM', createdAt: new Date().toISOString() }],
      ['aws-serverless', { roomId: 'aws-serverless', roomName: 'aws-serverless', inviteCode: 'AWSSRV', createdBy: 'SYSTEM', createdAt: new Date().toISOString() }],
      ['watercooler', { roomId: 'watercooler', roomName: 'watercooler', inviteCode: 'COOLER', createdBy: 'SYSTEM', createdAt: new Date().toISOString() }]
    ])
  },
  metrics: {
    wcu: 0,
    rcu: 0,
    totalRequests: 0
  },
  
  // Latency injection helper
  delay(ms = 25) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  async putItem(tableName, item) {
    this.metrics.totalRequests++;
    await this.delay(20); // 20ms write latency
    
    // Calculate simulated WCU (each write is at least 1 WCU, rough approximation)
    const itemSize = Buffer.byteLength(JSON.stringify(item));
    const wcuConsumed = Math.max(1, Math.ceil(itemSize / 1024));
    this.metrics.wcu += wcuConsumed;

    if (tableName === 'chat-connections') {
      this.tables['chat-connections'].set(item.connectionId, item);
    } else if (tableName === 'chat-messages') {
      this.tables['chat-messages'].push(item);
    } else if (tableName === 'chat-channels') {
      this.tables['chat-channels'].set(item.roomId, item);
    }

    broadcastTelemetry('ddb_operation', {
      operation: 'PutItem',
      table: tableName,
      item: item,
      wcu: wcuConsumed,
      rcu: 0,
      metrics: this.metrics
    });
    broadcastTelemetry('ddb_state', {
      connections: Array.from(this.tables['chat-connections'].values()),
      messages: this.tables['chat-messages'],
      channels: Array.from(this.tables['chat-channels'].values())
    });
    return item;
  },

  async deleteItem(tableName, key) {
    this.metrics.totalRequests++;
    await this.delay(15); // 15ms delete latency
    
    this.metrics.wcu += 1; // Deletes consume 1 WCU

    let deletedItem = null;
    if (tableName === 'chat-connections') {
      deletedItem = this.tables['chat-connections'].get(key.connectionId);
      this.tables['chat-connections'].delete(key.connectionId);
    }

    broadcastTelemetry('ddb_operation', {
      operation: 'DeleteItem',
      table: tableName,
      key: key,
      wcu: 1,
      rcu: 0,
      metrics: this.metrics
    });
    broadcastTelemetry('ddb_state', {
      connections: Array.from(this.tables['chat-connections'].values()),
      messages: this.tables['chat-messages'],
      channels: Array.from(this.tables['chat-channels'].values())
    });
    return deletedItem;
  },

  async getItem(tableName, key) {
    this.metrics.totalRequests++;
    await this.delay(10); // 10ms read latency
    
    this.metrics.rcu += 0.5; // Eventually consistent read: 0.5 RCU per 4KB

    let item = null;
    if (tableName === 'chat-connections') {
      item = this.tables['chat-connections'].get(key.connectionId) || null;
    } else if (tableName === 'chat-channels') {
      item = this.tables['chat-channels'].get(key.roomId) || null;
    }

    broadcastTelemetry('ddb_operation', {
      operation: 'GetItem',
      table: tableName,
      key: key,
      wcu: 0,
      rcu: 0.5,
      metrics: this.metrics
    });
    return item;
  },

  async scan(tableName) {
    this.metrics.totalRequests++;
    await this.delay(35); // Scans take longer
    
    let items = [];
    if (tableName === 'chat-connections') {
      items = Array.from(this.tables['chat-connections'].values());
    } else if (tableName === 'chat-messages') {
      items = this.tables['chat-messages'];
    } else if (tableName === 'chat-channels') {
      items = Array.from(this.tables['chat-channels'].values());
    }

    const itemsSize = Buffer.byteLength(JSON.stringify(items));
    const rcuConsumed = Math.max(1, Math.ceil(itemsSize / 4096)) * 0.5; // Eventually consistent Scan
    this.metrics.rcu += rcuConsumed;

    broadcastTelemetry('ddb_operation', {
      operation: 'Scan',
      table: tableName,
      wcu: 0,
      rcu: rcuConsumed,
      metrics: this.metrics
    });
    return items;
  },

  async query(tableName, roomId) {
    this.metrics.totalRequests++;
    await this.delay(18); // Queries are fast indexes
    
    let items = [];
    if (tableName === 'chat-messages') {
      items = this.tables['chat-messages'].filter(msg => msg.roomId === roomId);
    }

    const itemsSize = Buffer.byteLength(JSON.stringify(items));
    const rcuConsumed = Math.max(0.5, Math.ceil(itemsSize / 4096) * 0.5);
    this.metrics.rcu += rcuConsumed;

    broadcastTelemetry('ddb_operation', {
      operation: 'Query',
      table: tableName,
      keyCondition: `roomId = ${roomId}`,
      wcu: 0,
      rcu: rcuConsumed,
      metrics: this.metrics
    });
    return items;
  }
};

// ==========================================
// SIMULATED AWS LAMBDA RUNTIME
// ==========================================
const lambdaState = {
  'onConnect': { lastActive: 0, memory: 128 },
  'onDisconnect': { lastActive: 0, memory: 128 },
  'sendMessage': { lastActive: 0, memory: 128 },
  'getMessages': { lastActive: 0, memory: 128 },
  'getChannels': { lastActive: 0, memory: 128 },
  'createChannel': { lastActive: 0, memory: 128 },
  'joinChannel': { lastActive: 0, memory: 128 }
};

const COLD_START_TIMEOUT = 12000; // 12 seconds idle triggers cold start

async function invokeLambda(functionName, payload, wsClient) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  const state = lambdaState[functionName];
  const isColdStart = (startTime - state.lastActive) > COLD_START_TIMEOUT;
  
  // Simulate cold start delay
  let coldStartDelay = 0;
  if (isColdStart) {
    coldStartDelay = Math.floor(Math.random() * 800) + 700; // 700 - 1500 ms cold start
    await new Promise(r => setTimeout(r, coldStartDelay));
  }
  
  state.lastActive = Date.now();
  
  // Format logs buffer
  const logs = [];
  const log = (msg, level = 'INFO') => {
    const timestamp = new Date().toISOString();
    logs.push(`${timestamp} ${level} ${msg}`);
  };

  // Start Lambdas logging
  const initLine = isColdStart ? `\nSTART RequestId: ${requestId} Version: $LATEST\nINIT_START Runtime Version: nodejs18.x Runtime Version ARN: arn:aws:lambda:us-east-1::runtime:8a39b4b` : `START RequestId: ${requestId} Version: $LATEST`;
  logs.push(initLine);
  if (isColdStart) {
    log(`Cold start detected. Initialization took ${coldStartDelay} ms. Loading handler code and dependencies...`);
  }

  log(`Function invoked with event payload: ${JSON.stringify(payload)}`);

  // Execute function logic
  let result = null;
  let hasError = false;
  try {
    if (functionName === 'onConnect') {
      log('Running onConnect handler. Registering WebSocket client...');
      await dynamoDB.putItem('chat-connections', {
        connectionId: payload.connectionId,
        username: payload.username || 'Anonymous',
        avatar: payload.avatar || '🤖',
        connectedAt: new Date().toISOString()
      });
      log(`Client successfully registered in DynamoDB: ${payload.connectionId}`);
      
    } else if (functionName === 'onDisconnect') {
      log('Running onDisconnect handler. Removing WebSocket client...');
      await dynamoDB.deleteItem('chat-connections', { connectionId: payload.connectionId });
      log(`Client removed from DynamoDB: ${payload.connectionId}`);
      
    } else if (functionName === 'sendMessage') {
      log('Running sendMessage handler. Processing new message...');
      
      // 1. Fetch sender profile
      log(`DynamoDB GetItem: Fetching profile for connection ID: ${payload.connectionId}`);
      const sender = await dynamoDB.getItem('chat-connections', { connectionId: payload.connectionId });
      const username = sender ? sender.username : 'Anonymous';
      const avatar = sender ? sender.avatar : '💬';
      
      // 2. Put message
      const messageItem = {
        messageId: crypto.randomUUID(),
        roomId: payload.roomId || 'general',
        username,
        avatar,
        content: payload.content,
        timestamp: Date.now()
      };
      log(`DynamoDB PutItem: Storing chat message in chat-messages table: ${messageItem.messageId}`);
      await dynamoDB.putItem('chat-messages', messageItem);

      // 3. Scan connections & Broadcast (mock API Gateway postToConnection)
      log('DynamoDB Scan: Getting list of active WebSocket connection IDs...');
      const activeConnections = await dynamoDB.scan('chat-connections');
      log(`Found ${activeConnections.length} active connection(s). Simulating API Gateway PostToConnection loop...`);

      // We perform the actual broadcast inside the simulator
      for (const conn of activeConnections) {
        log(`API Gateway: Posting message payload to socket ${conn.connectionId}`);
        sendToWebSocket(conn.connectionId, {
          action: 'messageReceived',
          data: messageItem
        });
      }
      
    } else if (functionName === 'getMessages') {
      log(`Running getMessages handler. Fetching messages for room: ${payload.roomId}`);
      log(`DynamoDB Query: Querying chat-messages where roomId = ${payload.roomId}`);
      const messages = await dynamoDB.query('chat-messages', payload.roomId);
      log(`Found ${messages.length} messages. Sending back to client ${payload.connectionId}`);
      
      sendToWebSocket(payload.connectionId, {
        action: 'messagesHistory',
        data: {
          roomId: payload.roomId,
          messages: messages.slice(-50) // Send last 50 messages
        }
      });
    } else if (functionName === 'getChannels') {
      log('Running getChannels handler. Scanning chat-channels...');
      const channels = await dynamoDB.scan('chat-channels');
      log(`Found ${channels.length} channels. Sending to connection ${payload.connectionId}`);
      
      sendToWebSocket(payload.connectionId, {
        action: 'channelsList',
        data: channels
      });
    } else if (functionName === 'createChannel') {
      log(`Running createChannel handler. Room Name: ${payload.roomName}`);
      const roomId = crypto.randomUUID();
      
      // Generate unique 6-character uppercase alphanumeric code
      const inviteCode = crypto.randomBytes(3).toString('hex').toUpperCase();
      
      const newRoom = {
        roomId,
        roomName: payload.roomName,
        inviteCode,
        createdBy: payload.connectionId,
        createdAt: new Date().toISOString()
      };
      
      log(`DynamoDB PutItem: Registering new channel: "${payload.roomName}" with code ${inviteCode}`);
      await dynamoDB.putItem('chat-channels', newRoom);
      
      log('Broadcasting updated channels list to all active connections...');
      const allChannels = await dynamoDB.scan('chat-channels');
      
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            action: 'channelsList',
            data: allChannels
          }));
        }
      });

      sendToWebSocket(payload.connectionId, {
        action: 'channelCreated',
        data: newRoom
      });
    } else if (functionName === 'joinChannel') {
      log(`Running joinChannel handler. Resolving Invite Code: ${payload.inviteCode}`);
      
      log('DynamoDB Scan: Finding channel associated with invite code...');
      const allChannels = await dynamoDB.scan('chat-channels');
      const targetChannel = allChannels.find(ch => ch.inviteCode === payload.inviteCode);
      
      if (!targetChannel) {
        log(`[WARNING] Invite code failed to resolve: "${payload.inviteCode}"`, 'WARN');
        sendToWebSocket(payload.connectionId, {
          action: 'joinChannelFailed',
          data: { message: 'Invalid or expired invite code' }
        });
        return;
      }
      
      log(`Successfully resolved code to room: "${targetChannel.roomName}" (${targetChannel.roomId})`);
      sendToWebSocket(payload.connectionId, {
        action: 'channelJoined',
        data: targetChannel
      });
    }
  } catch (error) {
    hasError = true;
    log(`ERROR Execution failed: ${error.message}`, 'ERROR');
    log(error.stack, 'ERROR');
  }

  // End and Report Lambda logs
  const duration = Date.now() - startTime;
  const billedDuration = Math.ceil(duration / 100) * 100; // Billed in 100ms increments
  const maxMemory = Math.floor(Math.random() * 10) + 32; // Random memory footprint 32MB - 42MB
  
  logs.push(`END RequestId: ${requestId}`);
  
  let reportLine = `REPORT RequestId: ${requestId}\tDuration: ${duration.toFixed(2)} ms\tBilled Duration: ${billedDuration} ms\tMemory Size: ${state.memory} MB\tMax Memory Used: ${maxMemory} MB`;
  if (isColdStart) {
    reportLine += `\tInit Duration: ${coldStartDelay.toFixed(2)} ms`;
  }
  logs.push(reportLine);

  // Broadcast logs to the admin UI console
  broadcastTelemetry('lambda_logs', {
    functionName,
    requestId,
    isColdStart,
    duration,
    billedDuration,
    logs: logs.join('\n')
  });

  return {
    statusCode: hasError ? 500 : 200,
    body: result
  };
}

// Helper to send a WebSocket payload back to a client
function sendToWebSocket(connectionId, messageObj) {
  wss.clients.forEach(client => {
    if (client.connectionId === connectionId && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(messageObj));
    }
  });
}

// ==========================================
// ADMIN TELEMETRY ROUTER
// ==========================================
function broadcastTelemetry(type, data) {
  const telemetryMessage = JSON.stringify({
    action: 'telemetry',
    telemetryType: type,
    data: data
  });
  
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(telemetryMessage);
    }
  });
}

// ==========================================
// WEBSOCKET ROUTING (API Gateway Simulation)
// ==========================================
wss.on('connection', async (ws, req) => {
  const connectionId = crypto.randomUUID();
  ws.connectionId = connectionId;

  // Visual pulse: Client -> API Gateway (Connect)
  broadcastTelemetry('visual_pulse', {
    from: 'client',
    to: 'apigateway',
    action: 'connect',
    connectionId
  });

  await new Promise(r => setTimeout(r, 80));

  const clientIp = req.socket.remoteAddress;
  broadcastTelemetry('apigateway_logs', `[APIGateway] Establish connection RequestId: ${connectionId} Client IP: ${clientIp}`);

  // Route to onConnect Lambda
  broadcastTelemetry('visual_pulse', {
    from: 'apigateway',
    to: 'lambda-onconnect',
    action: 'invoke',
    connectionId
  });
  
  await invokeLambda('onConnect', { connectionId, ipAddress: clientIp }, ws);

  broadcastTelemetry('visual_pulse', {
    from: 'lambda-onconnect',
    to: 'apigateway',
    action: 'complete',
    connectionId
  });

  // Send connection details to client
  ws.send(JSON.stringify({
    action: 'connectionEstablished',
    data: { connectionId }
  }));

  // Handle client messages (API Gateway Routes)
  ws.on('message', async (messageStr) => {
    try {
      const message = JSON.parse(messageStr);
      const routeKey = message.action;
      
      broadcastTelemetry('apigateway_logs', `[APIGateway] Route: ${routeKey} | ConnectionId: ${connectionId}`);

      if (routeKey === 'registerProfile') {
        const profile = message.data || {};
        const connItem = await dynamoDB.getItem('chat-connections', { connectionId });
        if (connItem) {
          connItem.username = profile.username || connItem.username;
          connItem.avatar = profile.avatar || connItem.avatar;
          await dynamoDB.putItem('chat-connections', connItem);
          broadcastTelemetry('apigateway_logs', `[APIGateway] Registered profile for ${connectionId}: ${connItem.username}`);
        }
      } 
      
      else if (routeKey === 'sendMessage') {
        broadcastTelemetry('visual_pulse', {
          from: 'client',
          to: 'apigateway',
          action: 'sendMessage',
          connectionId
        });
        
        await new Promise(r => setTimeout(r, 40));
        
        broadcastTelemetry('visual_pulse', {
          from: 'apigateway',
          to: 'lambda-sendmessage',
          action: 'invoke',
          connectionId
        });

        await invokeLambda('sendMessage', {
          connectionId,
          roomId: message.data.roomId,
          content: message.data.content
        }, ws);

        broadcastTelemetry('visual_pulse', {
          from: 'lambda-sendmessage',
          to: 'apigateway',
          action: 'complete',
          connectionId
        });
      } 
      
      else if (routeKey === 'getMessages') {
        broadcastTelemetry('visual_pulse', {
          from: 'client',
          to: 'apigateway',
          action: 'getMessages',
          connectionId
        });
        
        await new Promise(r => setTimeout(r, 40));
        
        broadcastTelemetry('visual_pulse', {
          from: 'apigateway',
          to: 'lambda-getmessages',
          action: 'invoke',
          connectionId
        });

        await invokeLambda('getMessages', {
          connectionId,
          roomId: message.data.roomId
        }, ws);

        broadcastTelemetry('visual_pulse', {
          from: 'lambda-getmessages',
          to: 'apigateway',
          action: 'complete',
          connectionId
        });
      }
      
      else if (routeKey === 'getChannels') {
        broadcastTelemetry('visual_pulse', {
          from: 'client',
          to: 'apigateway',
          action: 'getChannels',
          connectionId
        });
        
        await new Promise(r => setTimeout(r, 40));
        
        broadcastTelemetry('visual_pulse', {
          from: 'apigateway',
          to: 'lambda-getchannels',
          action: 'invoke',
          connectionId
        });

        await invokeLambda('getChannels', { connectionId }, ws);

        broadcastTelemetry('visual_pulse', {
          from: 'lambda-getchannels',
          to: 'apigateway',
          action: 'complete',
          connectionId
        });
      }
      
      else if (routeKey === 'createChannel') {
        broadcastTelemetry('visual_pulse', {
          from: 'client',
          to: 'apigateway',
          action: 'createChannel',
          connectionId
        });
        
        await new Promise(r => setTimeout(r, 40));
        
        broadcastTelemetry('visual_pulse', {
          from: 'apigateway',
          to: 'lambda-createchannel',
          action: 'invoke',
          connectionId
        });

        await invokeLambda('createChannel', {
          connectionId,
          roomName: message.data.roomName
        }, ws);

        broadcastTelemetry('visual_pulse', {
          from: 'lambda-createchannel',
          to: 'apigateway',
          action: 'complete',
          connectionId
        });
      }
      
      else if (routeKey === 'joinChannel') {
        broadcastTelemetry('visual_pulse', {
          from: 'client',
          to: 'apigateway',
          action: 'joinChannel',
          connectionId
        });
        
        await new Promise(r => setTimeout(r, 40));
        
        broadcastTelemetry('visual_pulse', {
          from: 'apigateway',
          to: 'lambda-joinchannel',
          action: 'invoke',
          connectionId
        });

        await invokeLambda('joinChannel', {
          connectionId,
          inviteCode: message.data.inviteCode
        }, ws);

        broadcastTelemetry('visual_pulse', {
          from: 'lambda-joinchannel',
          to: 'apigateway',
          action: 'complete',
          connectionId
        });
      }
    } catch (e) {
      broadcastTelemetry('apigateway_logs', `[APIGateway ERROR] Failed to parse message: ${e.message}`);
    }
  });

  // Client disconnect
  ws.on('close', async () => {
    broadcastTelemetry('apigateway_logs', `[APIGateway] Connection closed: ${connectionId}`);
    
    broadcastTelemetry('visual_pulse', {
      from: 'client',
      to: 'apigateway',
      action: 'disconnect',
      connectionId
    });
    
    await new Promise(r => setTimeout(r, 30));

    broadcastTelemetry('visual_pulse', {
      from: 'apigateway',
      to: 'lambda-ondisconnect',
      action: 'invoke',
      connectionId
    });

    await invokeLambda('onDisconnect', { connectionId }, ws);

    broadcastTelemetry('visual_pulse', {
      from: 'lambda-ondisconnect',
      to: 'apigateway',
      action: 'complete',
      connectionId
    });
  });
});

// Start Express + WebSocket server
server.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`🚀 Serverless Chat Application Simulator is running locally!`);
  console.log(`👉 Access URL: http://localhost:${PORT}`);
  console.log(`================================================================`);
});
