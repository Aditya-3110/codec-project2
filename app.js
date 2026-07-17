// ==========================================
// STATE MANAGEMENT & CONFIG
// ==========================================
let ws = null;
let myConnectionId = null;
let currentRoom = 'general';
let selectedAvatar = '🐱';
let username = '';
let activeTab = 'visualizer';
let activeLogGroup = 'apigateway';
let activeDDBTable = 'chat-connections';

// Local cache for logs and DB to allow tab switching without losing state
const logsCache = {
  'apigateway': [],
  'lambda-onconnect': [],
  'lambda-ondisconnect': [],
  'lambda-sendmessage': [],
  'lambda-getmessages': [],
  'lambda-getchannels': [],
  'lambda-createchannel': [],
  'lambda-joinchannel': []
};

const ddbCache = {
  'chat-connections': [],
  'chat-messages': [],
  'chat-channels': []
};

// Inject keyframe animation for the path particle flow
const style = document.createElement('style');
style.textContent = `
  @keyframes flow {
    0% { offset-distance: 0%; opacity: 0; transform: scale(0.6); }
    15% { opacity: 1; transform: scale(1.2); }
    85% { opacity: 1; transform: scale(1.2); }
    100% { offset-distance: 100%; opacity: 0; transform: scale(0.6); }
  }
`;
document.head.appendChild(style);

// ==========================================
// DOM ELEMENTS
// ==========================================
const chatAuth = document.getElementById('chatAuth');
const chatApp = document.getElementById('chatApp');
const usernameInput = document.getElementById('usernameInput');
const avatarPicker = document.getElementById('avatarPicker');
const connectChatBtn = document.getElementById('connectChatBtn');
const myConnectionIdDisplay = document.getElementById('myConnectionId');

// Chat UI Elements
const messagesContainer = document.getElementById('messagesContainer');
const chatInputForm = document.getElementById('chatInputForm');
const messageInput = document.getElementById('messageInput');
const currentRoomTitle = document.getElementById('currentRoomTitle');
const userNameDisplay = document.getElementById('userName');
const userAvatarDisplay = document.getElementById('userAvatar');
const userConnDisplay = document.getElementById('userConn');
const channelList = document.getElementById('channelList');

// Modals
const createChannelModal = document.getElementById('createChannelModal');
const joinChannelModal = document.getElementById('joinChannelModal');
const openCreateModalBtn = document.getElementById('openCreateModalBtn');
const openJoinModalBtn = document.getElementById('openJoinModalBtn');
const closeCreateModalBtn = document.getElementById('closeCreateModalBtn');
const closeJoinModalBtn = document.getElementById('closeJoinModalBtn');

const newChannelNameInput = document.getElementById('newChannelNameInput');
const submitCreateChannelBtn = document.getElementById('submitCreateChannelBtn');
const codeShareBox = document.getElementById('codeShareBox');
const inviteCodeDisplay = document.getElementById('inviteCodeDisplay');
const copyCodeBtn = document.getElementById('copyCodeBtn');

const joinInviteCodeInput = document.getElementById('joinInviteCodeInput');
const submitJoinChannelBtn = document.getElementById('submitJoinChannelBtn');
const joinErrorMsg = document.getElementById('joinErrorMsg');

// Tabs & Navigation
const navTabs = document.querySelectorAll('.nav-tab');
const tabPanels = document.querySelectorAll('.tab-panel');

// Logs Panel Elements
const logGroupItems = document.querySelectorAll('.log-group-item');
const logsConsole = document.getElementById('logsConsole');
const currentLogGroupTitle = document.getElementById('currentLogGroupTitle');
const clearLogsBtn = document.getElementById('clearLogsBtn');

// DynamoDB Panel Elements
const ddbTableItems = document.querySelectorAll('.ddb-table-item');
const ddbTableContent = document.getElementById('ddbTableContent');
const currentDDBTableTitle = document.getElementById('currentDDBTableTitle');
const countConnections = document.getElementById('count-connections');
const countMessages = document.getElementById('count-messages');
const countChannels = document.getElementById('count-channels');
const wcuPercent = document.getElementById('wcuPercent');
const rcuPercent = document.getElementById('rcuPercent');
const wcuBar = document.getElementById('wcuBar');
const rcuBar = document.getElementById('rcuBar');

// Visualizer Metrics
const metricConnections = document.getElementById('metric-connections');
const metricWcu = document.getElementById('metric-wcu');
const metricRcu = document.getElementById('metric-rcu');
const metricErrors = document.getElementById('metric-errors');

// ==========================================
// TAB CONTROLS & SIDEBARS
// ==========================================
navTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    navTabs.forEach(t => t.classList.remove('active'));
    tabPanels.forEach(p => p.classList.remove('active'));
    
    tab.classList.add('active');
    activeTab = tab.dataset.tab;
    document.getElementById(`tab-${activeTab}`).classList.add('active');
    
    if (activeTab === 'visualizer') {
      setTimeout(updateSVGPaths, 50);
    }
  });
});

logGroupItems.forEach(item => {
  item.addEventListener('click', () => {
    logGroupItems.forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    activeLogGroup = item.dataset.logGroup;
    currentLogGroupTitle.textContent = item.textContent;
    renderLogs();
  });
});

ddbTableItems.forEach(item => {
  item.addEventListener('click', () => {
    ddbTableItems.forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    activeDDBTable = item.dataset.table;
    currentDDBTableTitle.textContent = `Table: ${activeDDBTable}`;
    renderDDBTable();
  });
});

// Avatar selection UI helper
avatarPicker.addEventListener('click', (e) => {
  const target = e.target;
  if (target.classList.contains('avatar-opt')) {
    document.querySelectorAll('.avatar-opt').forEach(opt => opt.classList.remove('active'));
    target.classList.add('active');
    selectedAvatar = target.dataset.avatar;
  }
});

// ==========================================
// MODAL CONTROLS
// ==========================================
openCreateModalBtn.addEventListener('click', () => {
  createChannelModal.classList.remove('hidden');
  newChannelNameInput.value = '';
  codeShareBox.classList.add('hidden');
});

closeCreateModalBtn.addEventListener('click', () => {
  createChannelModal.classList.add('hidden');
});

openJoinModalBtn.addEventListener('click', () => {
  joinChannelModal.classList.remove('hidden');
  joinInviteCodeInput.value = '';
  joinErrorMsg.classList.add('hidden');
});

closeJoinModalBtn.addEventListener('click', () => {
  joinChannelModal.classList.add('hidden');
});

// Close modals when clicking outside
window.addEventListener('click', (e) => {
  if (e.target === createChannelModal) createChannelModal.classList.add('hidden');
  if (e.target === joinChannelModal) joinChannelModal.classList.add('hidden');
});

// Create Room Action
submitCreateChannelBtn.addEventListener('click', () => {
  const roomName = newChannelNameInput.value.trim();
  if (!roomName) {
    alert('Please enter a channel name');
    return;
  }
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'createChannel',
      data: { roomName }
    }));
  }
});

// Join Room Action
submitJoinChannelBtn.addEventListener('click', () => {
  const code = joinInviteCodeInput.value.trim().toUpperCase();
  if (!code) {
    alert('Please enter an invite code');
    return;
  }
  
  joinErrorMsg.classList.add('hidden');
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'joinChannel',
      data: { inviteCode: code }
    }));
  }
});

// Copy Invite Code Helper
copyCodeBtn.addEventListener('click', () => {
  const code = inviteCodeDisplay.textContent;
  navigator.clipboard.writeText(code).then(() => {
    copyCodeBtn.textContent = 'Copied!';
    copyCodeBtn.style.background = '#059669';
    setTimeout(() => {
      copyCodeBtn.textContent = 'Copy Code';
      copyCodeBtn.style.background = 'var(--success)';
    }, 2000);
  });
});

// ==========================================
// CHAT APPLICATION EVENTS
// ==========================================
connectChatBtn.addEventListener('click', () => {
  const enteredName = usernameInput.value.trim();
  if (!enteredName) {
    alert('Please enter a username');
    return;
  }
  
  username = enteredName;
  chatAuth.classList.add('hidden');
  chatApp.classList.remove('hidden');
  
  userNameDisplay.textContent = username;
  userAvatarDisplay.textContent = selectedAvatar;
  
  initWebSocket();
});

// Message Sending
chatInputForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'sendMessage',
      data: {
        roomId: currentRoom,
        content: text
      }
    }));
    
    messageInput.value = '';
    messageInput.focus();
  }
});

// ==========================================
// WEBSOCKET COMMUNICATION
// ==========================================
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    addSystemLog('apigateway', `[SYSTEM] Opening WebSocket Handshake...`);
  };
  
  ws.onmessage = (event) => {
    const response = JSON.parse(event.data);
    
    if (response.action === 'telemetry') {
      handleTelemetryEvent(response.telemetryType, response.data);
    } else {
      handleChatAppEvent(response.action, response.data);
    }
  };
  
  ws.onclose = () => {
    myConnectionIdDisplay.textContent = 'Disconnected';
    myConnectionIdDisplay.style.color = 'var(--accent)';
    addSystemLog('apigateway', `[SYSTEM ERROR] Connection to AWS WebSocket API Gateway closed.`);
    setTimeout(initWebSocket, 3000); // Retry reconnect in 3s
  };

  ws.onerror = (err) => {
    console.error('Socket error:', err);
  };
}

// Chat app handlers
function handleChatAppEvent(action, data) {
  if (action === 'connectionEstablished') {
    myConnectionId = data.connectionId;
    myConnectionIdDisplay.textContent = `ID: ${myConnectionId.slice(0, 8)}...`;
    myConnectionIdDisplay.style.color = 'var(--success)';
    
    userConnDisplay.textContent = `ID: ${myConnectionId.slice(0, 8)}...`;
    
    // Register User Metadata inside the Gateway Simulator
    ws.send(JSON.stringify({
      action: 'registerProfile',
      data: { username, avatar: selectedAvatar }
    }));
    
    // Fetch channels list
    ws.send(JSON.stringify({
      action: 'getChannels'
    }));

    // Fetch initial messages history
    ws.send(JSON.stringify({
      action: 'getMessages',
      data: { roomId: currentRoom }
    }));
  } 
  
  else if (action === 'channelsList') {
    renderChannelsSidebar(data);
  }
  
  else if (action === 'channelCreated') {
    inviteCodeDisplay.textContent = data.inviteCode;
    codeShareBox.classList.remove('hidden');
    
    // Sync table contents immediately
    ws.send(JSON.stringify({ action: 'getChannels' }));
  }
  
  else if (action === 'channelJoined') {
    joinChannelModal.classList.add('hidden');
    
    // Switch active channel
    currentRoom = data.roomId;
    currentRoomTitle.textContent = `# ${data.roomName}`;
    messagesContainer.innerHTML = '';
    
    // Fetch messages
    ws.send(JSON.stringify({
      action: 'getMessages',
      data: { roomId: currentRoom }
    }));
    
    // Refresh list to show active highlight
    ws.send(JSON.stringify({ action: 'getChannels' }));
  }
  
  else if (action === 'joinChannelFailed') {
    joinErrorMsg.textContent = data.message;
    joinErrorMsg.classList.remove('hidden');
  }
  
  else if (action === 'messagesHistory') {
    if (data.roomId === currentRoom) {
      messagesContainer.innerHTML = '';
      if (data.messages && data.messages.length > 0) {
        data.messages.forEach(msg => appendMessageBubble(msg));
      } else {
        messagesContainer.innerHTML = `<div class="empty-ddb-msg"><span>💬</span>Welcome! Send a message to start conversation.</div>`;
      }
      scrollToBottom();
    }
  } 
  
  else if (action === 'messageReceived') {
    const msg = data;
    if (msg.roomId === currentRoom) {
      const placeholder = messagesContainer.querySelector('.empty-ddb-msg');
      if (placeholder) placeholder.remove();
      
      appendMessageBubble(msg);
      scrollToBottom();
    }
  }
}

// Render dynamic channel sidebar
function renderChannelsSidebar(channels) {
  channelList.innerHTML = '';
  channels.forEach(ch => {
    const li = document.createElement('li');
    li.className = `channel-item ${ch.roomId === currentRoom ? 'active' : ''}`;
    li.dataset.room = ch.roomId;
    li.textContent = `# ${ch.roomName}`;
    
    li.addEventListener('click', () => {
      document.querySelectorAll('.channel-item').forEach(c => c.classList.remove('active'));
      li.classList.add('active');
      currentRoom = ch.roomId;
      currentRoomTitle.textContent = `# ${ch.roomName}`;
      messagesContainer.innerHTML = '';
      
      ws.send(JSON.stringify({
        action: 'getMessages',
        data: { roomId: currentRoom }
      }));
    });
    
    channelList.appendChild(li);
  });
}

// Append message bubbles to chat client view
function appendMessageBubble(msg) {
  const isMine = msg.username === username;
  const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${isMine ? 'mine' : ''}`;
  
  bubble.innerHTML = `
    <div class="bubble-avatar">${msg.avatar}</div>
    <div class="bubble-content">
      <div class="bubble-meta">
        <span class="sender-name">${msg.username}</span>
        <span class="msg-time">${time}</span>
      </div>
      <div class="bubble-text">${msg.content}</div>
      <div class="msg-status processed">✓ Serverless Processed</div>
    </div>
  `;
  
  messagesContainer.appendChild(bubble);
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ==========================================
// TELEMETRY PANEL HANDLERS (Console logs, DB state, and Visualizer)
// ==========================================
function handleTelemetryEvent(type, payload) {
  if (type === 'apigateway_logs') {
    addSystemLog('apigateway', payload);
  } 
  
  else if (type === 'lambda_logs') {
    const logGroup = `lambda-${payload.functionName.toLowerCase()}`;
    addSystemLog(logGroup, payload.logs);
    
    // Trigger visual cold start indicators
    if (payload.isColdStart) {
      const node = document.getElementById(`node-${logGroup}`);
      if (node) {
        node.classList.add('cold-started');
        setTimeout(() => node.classList.remove('cold-started'), 6000);
      }
    }
  } 
  
  else if (type === 'ddb_operation') {
    animateNodePulse('node-ddb', 'success');
    
    metricWcu.textContent = Math.round(payload.metrics.wcu);
    metricRcu.textContent = payload.metrics.rcu;
    
    updateDDBMeters(payload.metrics.wcu, payload.metrics.rcu);
  } 
  
  else if (type === 'ddb_state') {
    ddbCache['chat-connections'] = payload.connections;
    ddbCache['chat-messages'] = payload.messages;
    ddbCache['chat-channels'] = payload.channels;
    
    // Update Table Item Count displays
    countConnections.textContent = `${payload.connections.length} items`;
    countMessages.textContent = `${payload.messages.length} items`;
    if (countChannels) {
      countChannels.textContent = `${payload.channels.length} items`;
    }
    
    // Update Metrics Dashboard Connection count
    metricConnections.textContent = payload.connections.length;
    
    // Re-render DDB table explorer if visible
    renderDDBTable();
  } 
  
  else if (type === 'visual_pulse') {
    triggerFlowPulse(payload.from, payload.to);
  }
}

// ==========================================
// LOGS STREAM GRAPHICS & TEXT
// ==========================================
function addSystemLog(logGroup, text) {
  const lines = text.split('\n');
  lines.forEach(line => {
    if (!line.trim()) return;
    
    let formattedLine = line;
    let className = 'info';
    
    if (logGroup === 'apigateway') {
      className = 'apigw';
    } else {
      if (line.startsWith('START')) {
        className = 'start';
      } else if (line.startsWith('END')) {
        className = 'end';
      } else if (line.startsWith('REPORT')) {
        className = 'report';
      } else if (line.includes('ERROR')) {
        className = 'error';
      }
    }
    
    logsCache[logGroup].push({ text: formattedLine, className });
  });
  
  if (logsCache[logGroup].length > 500) {
    logsCache[logGroup].shift();
  }
  
  if (activeTab === 'logs' && activeLogGroup === logGroup) {
    renderLogs();
  }
}

function renderLogs() {
  logsConsole.innerHTML = '';
  const lines = logsCache[activeLogGroup];
  
  if (lines.length === 0) {
    logsConsole.innerHTML = `<div style="color: var(--text-dark); font-style: italic;">No logs stream available. Trigger some actions in the Chat.</div>`;
    return;
  }
  
  lines.forEach(line => {
    const div = document.createElement('div');
    div.className = `log-line ${line.className}`;
    div.textContent = line.text;
    logsConsole.appendChild(div);
  });
  
  logsConsole.scrollTop = logsConsole.scrollHeight;
}

clearLogsBtn.addEventListener('click', () => {
  logsCache[activeLogGroup] = [];
  renderLogs();
});

// ==========================================
// DYNAMODB GRAPHICS & RENDER
// ==========================================
function renderDDBTable() {
  ddbTableContent.innerHTML = '';
  const items = ddbCache[activeDDBTable];
  
  if (!items || items.length === 0) {
    ddbTableContent.innerHTML = `
      <div class="empty-ddb-msg">
        <span>💿</span>
        No records found in table "${activeDDBTable}".
      </div>
    `;
    return;
  }
  
  const container = document.createElement('div');
  container.className = 'json-viewer';
  
  items.forEach(item => {
    const itemBlock = document.createElement('div');
    itemBlock.className = 'json-item-block';
    
    let jsonStr = JSON.stringify(item, null, 2);
    jsonStr = jsonStr.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    const highlightedJson = jsonStr.replace(/("(\\u[a-zA-Z0-8]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, function (match) {
      let cls = 'json-number';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'json-key';
        } else {
          cls = 'json-string';
        }
      } else if (/true|false/.test(match)) {
        cls = 'json-boolean';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return '<span class="' + cls + '">' + match + '</span>';
    });
    
    itemBlock.innerHTML = highlightedJson;
    container.appendChild(itemBlock);
  });
  
  ddbTableContent.appendChild(container);
}

function updateDDBMeters(wcu, rcu) {
  const maxCapacity = 50;
  const wcuRate = Math.min(100, (wcu / maxCapacity) * 100);
  const rcuRate = Math.min(100, (rcu / maxCapacity) * 100);
  
  wcuPercent.textContent = `${wcu.toFixed(1)} WCUs`;
  rcuPercent.textContent = `${rcu.toFixed(1)} RCUs`;
  
  wcuBar.style.width = `${wcuRate}%`;
  rcuBar.style.width = `${rcuRate}%`;
}

// ==========================================
// ARCHITECTURE MAP COORDINATES AND PARTICLE FLOW
// ==========================================
function updateSVGPaths() {
  const mapElement = document.querySelector('.architecture-map');
  if (!mapElement || activeTab !== 'visualizer') return;

  const mapRect = mapElement.getBoundingClientRect();

  function getCenterPos(elId, side) {
    const el = document.getElementById(elId);
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    
    const rx = rect.left - mapRect.left;
    const ry = rect.top - mapRect.top;
    
    if (side === 'left') {
      return { x: rx, y: ry + rect.height / 2 };
    } else if (side === 'right') {
      return { x: rx + rect.width, y: ry + rect.height / 2 };
    }
    return { x: rx + rect.width / 2, y: ry + rect.height / 2 };
  }

  // Draw paths
  const clientRight = getCenterPos('node-client', 'right');
  const apigwLeft = getCenterPos('node-apigw', 'left');
  const apigwRight = getCenterPos('node-apigw', 'right');
  const ddbLeft = getCenterPos('node-ddb', 'left');

  // Client -> API Gateway
  drawCurvedPath('path-client-apigw', clientRight, apigwLeft);

  // API Gateway -> Lambdas & Lambdas -> DynamoDB (All 7 Lambdas)
  const lambdas = [
    'onconnect', 'ondisconnect', 'sendmessage', 
    'getmessages', 'getchannels', 'createchannel', 'joinchannel'
  ];
  lambdas.forEach(name => {
    const lNodeLeft = getCenterPos(`node-lambda-${name}`, 'left');
    const lNodeRight = getCenterPos(`node-lambda-${name}`, 'right');
    
    drawCurvedPath(`path-apigw-lambda-${name}`, apigwRight, lNodeLeft);
    drawCurvedPath(`path-lambda-${name}-ddb`, lNodeRight, ddbLeft);
  });
}

function drawCurvedPath(pathId, start, end) {
  const path = document.getElementById(pathId);
  if (!path) return;
  
  const dx = Math.abs(end.x - start.x) * 0.45;
  const d = `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${end.x - dx} ${end.y}, ${end.x} ${end.y}`;
  path.setAttribute('d', d);
}

// Particle flow triggers along SVG paths
function triggerFlowPulse(from, to) {
  let pathId = null;
  if (from === 'client' && to === 'apigateway') {
    pathId = 'path-client-apigw';
    animateNodePulse('node-client', 'active');
  } 
  
  else if (from === 'apigateway' && to.startsWith('lambda')) {
    pathId = `path-apigw-${to}`;
    animateNodePulse('node-apigw', 'active');
  } 
  
  else if (to === 'apigateway' && from.startsWith('lambda')) {
    pathId = `path-apigw-${from}`;
    animateNodePulse(`node-${from}`, 'success');
  }

  if (from.startsWith('lambda') && to === 'ddb') {
    pathId = `path-${from}-ddb`;
    animateNodePulse(`node-${from}`, 'active');
  }

  if (pathId) {
    const pathEl = document.getElementById(pathId);
    if (!pathEl) return;
    
    const dStr = pathEl.getAttribute('d');
    if (!dStr) return;

    pathEl.classList.add('path-active');
    setTimeout(() => pathEl.classList.remove('path-active'), 800);

    const container = document.getElementById('pulseContainer');
    const particle = document.createElement('div');
    particle.className = 'pulse-particle';
    particle.style.offsetPath = `path('${dStr}')`;
    
    if (to === 'apigateway' && from.startsWith('lambda')) {
      particle.style.animation = 'flow 0.7s cubic-bezier(0.25, 0.46, 0.45, 0.94) reverse forwards';
    } else {
      particle.style.animation = 'flow 0.7s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards';
    }

    container.appendChild(particle);
    particle.addEventListener('animationend', () => {
      particle.remove();
    });
  }
}

// Sparkle/glow nodes during operations
function animateNodePulse(nodeId, type) {
  const node = document.getElementById(nodeId);
  if (!node) return;
  
  const className = type === 'active' ? 'active-invoke' : 'active-success';
  node.classList.add(className);
  
  setTimeout(() => {
    node.classList.remove(className);
  }, type === 'active' ? 500 : 400);
}

// Listen for window resize to recalculate lines
window.addEventListener('resize', updateSVGPaths);
// Initial coordinates trigger
setTimeout(updateSVGPaths, 300);
