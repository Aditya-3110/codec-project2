# Real-Time Serverless Chat & Cloud Simulator

A fully local real-time chat application powered by WebSockets that  a complete AWS Serverless Cloud Architecture (AWS API Gateway, AWS Lambda Functions, and Amazon DynamoDB Tables). 

It features an interactive dual-panel interface: a functional chat application on the left, and a **Serverless Developer Console** on the right displaying live requests routing, CloudWatch log streams, database operations, and throughput metrics in real time.

---

## ⚡ Key Features

### 1. The Chat Client (Left Panel)
* **Custom Profiles**: Select username identities and customized emoji avatars.
* **Dynamic Channels**: Create custom chat rooms instantly.
* **Invite-Code Sharing**: Generates a shareable 6-digit alphanumeric invite code to let other tabs join your custom channel.
* **Real-time Messaging**: Exchanged messages are broadcasted instantly between all connected browser tabs.

### 2. The Cloud Simulator Dashboard (Right Panel)
* **Live Architecture Map**: An SVG-rendered diagram of the cloud architecture. Watch neon particles flow in real-time between nodes during executions:
  `Client` ──> `API Gateway` ──> `Lambda Function` ──> `DynamoDB Table`
* **CloudWatch Log Console**: Streams simulated logs structured exactly in the AWS CloudWatch format (`START`, `INFO`, `END`, `REPORT` showing duration, billed duration, memory limits, and request UUIDs).
* **Lambda Cold Start Simulation**: Simulates environment cleanups. If a function is idle for more than 12 seconds, it triggers a **Cold Start**, injecting a 700ms - 1500ms environment init delay and printing `INIT_START` logs in the console.
* **DynamoDB Console**:
  * Visualizes database tables (`chat-connections`, `chat-messages`, and `chat-channels`) with records rendered as syntax-highlighted JSON trees.
  * Measures Read and Write Capacity Units (RCUs & WCUs) consumed by query, scan, and put operations based on payload size.
  * Displays a live throughput progress bar compared against simulated provisioning.

---

## 📂 Project Structure

```
serverless-chat-simulator/
├── package.json         # Node.js dependencies (express, ws)
├── server.js            # Express server, WebSocket routes, Lambdas, and database simulator
├── README.md            # Project documentation
└── public/              # Frontend files
    ├── index.html       # Web page layout & SVG routing container
    ├── style.css        # Premium vanilla CSS variables, animations, and glassmorphism styling
    └── app.js           # WebSocket listeners, layout recalculator, and particle flow manager
```

---

## 🚀 How to Run Locally

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed (version 16 or higher recommended).

### 1. Install Dependencies
Open a terminal in the project directory and run:
```bash
npm install
```

### 2. Start the Server
Start the simulation server by running:
```bash
npm start
```
You should see:
```text
================================================================
🚀 Serverless Chat Application Simulator is running locally!
👉 Access URL: http://localhost:3000
================================================================
```

### 3. Open the Dashboard
Open your web browser and navigate to:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 🧪 Verification & Testing Scenarios

1. **Verify Live Message Broadcast**:
   - Open two browser tabs side-by-side.
   - Connect as two different users (e.g. `Alice` and `Bob`).
   - Send messages and verify they transmit instantly.

2. **Verify Channel Invitation**:
   - In Tab A, click **Create Room**, input `"Cloud-Talk"`, and copy the generated code.
   - In Tab B, click **Join with Code**, paste the code, and join.
   - Verify both users switch to `# Cloud-Talk` and can exchange messages.

3. **Inspect Simulated Cloud Logs**:
   - Go to the **CloudWatch Logs** tab on the developer dashboard.
   - Switch between function streams (e.g. `/aws/lambda/SendMessage` or `/aws/lambda/CreateChannel`) to read the execution outputs.

4. **Trigger a Lambda Cold Start**:
   - Stop sending messages in the chat for **12-15 seconds**.
   - Send a message. You will notice a slight processing delay (~1 second).
   - Check the logs for `/aws/lambda/SendMessage`. You will see `INIT_START` and `Init Duration` entries reporting the simulated cold start.

5. **Examine Database Contents**:
   - Go to the **DynamoDB Tables** tab.
   - Click on the `chat-messages` or `chat-channels` tables to explore raw record documents and trace capacity unit metrics.
