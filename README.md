# 🚀 Docker Reverse Proxy with Round-Robin Load Balancing

A production-ready reverse proxy built with Node.js that automatically discovers Docker containers and distributes traffic across multiple replicas using round-robin load balancing.

---

## 📚 Table of Contents

1. [What is a Proxy?](#-what-is-a-proxy)
2. [What is a Reverse Proxy?](#-what-is-a-reverse-proxy)
3. [Why Do We Need This?](#-why-do-we-need-this)
4. [What is Nginx?](#-what-is-nginx)
5. [Project Architecture](#-project-architecture)
6. [How It Works](#-how-it-works)
7. [Code Breakdown](#-code-breakdown)
8. [Installation & Usage](#-installation--usage)
9. [API Documentation](#-api-documentation)
10. [Advanced Examples](#-advanced-examples)

---

## 🔍 What is a Proxy?

A **proxy** is an intermediary server that sits between a client (your computer) and other servers on the internet.

### Forward Proxy (Regular Proxy)

```
You → Proxy Server → Internet (Google, Facebook, etc.)
```

**Example:** When you use a VPN, your requests go through the VPN server (proxy) before reaching websites.

**Benefits:**
- Hide your IP address
- Access geo-restricted content
- Filter/block certain websites (corporate networks)
- Cache frequently accessed content

**Real-world analogy:** Like having a personal assistant who makes phone calls on your behalf, so the person on the other end doesn't know who's really calling.

---

## 🔄 What is a Reverse Proxy?

A **reverse proxy** sits in front of your servers and routes client requests to the appropriate backend server.

```
Client → Reverse Proxy → [Server 1, Server 2, Server 3, ...]
```

**Key Difference:** 
- **Forward Proxy:** Protects clients (hides who's making the request)
- **Reverse Proxy:** Protects servers (hides which server is responding)

### Real-World Example

Imagine you visit `facebook.com`:
- You don't connect directly to Facebook's servers
- You connect to Facebook's reverse proxy (load balancer)
- The reverse proxy decides which of Facebook's 1000s of servers should handle your request
- You never know which specific server responded

**This is exactly what our project does!**

---

## ❓ Why Do We Need This?

### Without a Reverse Proxy

Let's say you have 3 nginx servers running:

```bash
# Server 1 on port 3001
docker run -p 3001:80 nginx

# Server 2 on port 3002
docker run -p 3002:80 nginx

# Server 3 on port 3003
docker run -p 3003:80 nginx
```

**Problems:**

1. **Manual Distribution:** You have to manually decide which server to use
   ```bash
   curl http://localhost:3001  # Use server 1
   curl http://localhost:3002  # Use server 2
   ```

2. **No Automatic Failover:** If server 1 crashes, you have to manually switch to server 2

3. **Uneven Load:** One server might get 100 requests while another gets 0

4. **Port Management Nightmare:** You need to remember all the ports

5. **No Single Entry Point:** Users need to know about all your servers

6. **SSL Complexity:** You need SSL certificates for each server

### With Our Reverse Proxy

```bash
# Just create containers - no port management needed!
docker run -d --network proxy-net --label service=web nginx
docker run -d --network proxy-net --label service=web nginx
docker run -d --network proxy-net --label service=web nginx

# Access all of them through ONE URL!
curl http://web.localhost
```

**Benefits:**

✅ **Single Entry Point:** One URL (`web.localhost`) for all servers  
✅ **Automatic Load Balancing:** Traffic distributed evenly (round-robin)  
✅ **Auto Discovery:** Containers automatically registered when started  
✅ **Auto Cleanup:** Dead containers automatically removed  
✅ **Service Grouping:** Multiple containers under one service name  
✅ **Zero Downtime:** Add/remove containers without stopping service  
✅ **Simplified SSL:** One SSL certificate for all backend servers  

---

## 🌐 What is Nginx?

**Nginx** (pronounced "engine-x") is a high-performance web server and reverse proxy.

### In This Project

Nginx is used as our **backend application servers**. Think of it like this:

```
User Request → Our Reverse Proxy → Nginx Container (serves the website)
```

**Why Nginx in examples?**
- It's lightweight and fast
- Perfect for testing (serves a simple HTML page)
- Industry standard for production workloads

**In Production:** Replace nginx with your actual application:
- Node.js app
- Python Flask/Django app
- Java Spring Boot app
- React/Vue build
- Any containerized application!

---

## 🏗️ Project Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER REQUEST                            │
│                    http://web.localhost                         │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
        ┌─────────────────────────────┐
        │   REVERSE PROXY (Port 80)   │
        │                             │
        │  • Receives request         │
        │  • Checks subdomain "web"   │
        │  • Finds service in DB      │
        │  • Selects next target      │
        │    (round-robin)            │
        └─────────────┬───────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
    ┌───────┐     ┌───────┐     ┌───────┐
    │ Nginx │     │ Nginx │     │ Nginx │
    │ :80   │     │ :80   │     │ :80   │
    │172.X.1│     │172.X.2│     │172.X.3│
    └───────┘     └───────┘     └───────┘
      ▲             ▲             ▲
      │             │             │
      └─────────────┴─────────────┘
              Docker Network
           (reverse-proxy_proxy-net)

┌─────────────────────────────────────────┐
│    MANAGEMENT API (Port 8080)           │
│                                         │
│  POST /containers → Create service      │
│  GET  /services   → List all services   │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│       DOCKER EVENT LISTENER             │
│                                         │
│  • Listens for container start/stop    │
│  • Auto-registers new containers       │
│  • Auto-removes dead containers        │
│  • Updates service registry (DB)       │
└─────────────────────────────────────────┘
```

### Components

1. **Reverse Proxy Server (Port 80)**
   - Receives all incoming HTTP requests
   - Routes to appropriate backend container
   - Uses round-robin for load distribution

2. **Management API (Port 8080)**
   - REST API for creating services
   - Lists registered services and targets

3. **Docker Event Listener**
   - Watches Docker daemon for container events
   - Auto-registers containers with `proxy-net` network
   - Maintains service registry in memory

4. **In-Memory Database (Map)**
   - Stores service → targets mapping
   - Tracks round-robin index for each service

---

## ⚙️ How It Works

### Complete Workflow

#### 1. User Creates a Service

```bash
curl -X POST http://localhost:8080/containers \
  -H "Content-Type: application/json" \
  -d '{"image": "nginx", "replicas": 3, "service": "web"}'
```

**What Happens:**

```
Management API receives request
    ↓
Check if nginx image exists locally
    ↓
If not, pull from Docker Hub
    ↓
Find proxy network (reverse-proxy_proxy-net)
    ↓
FOR each replica (1 to 3):
    ↓
    Create container with:
    • Image: nginx:latest
    • Network: reverse-proxy_proxy-net
    • Label: service=web
    • AutoRemove: true
    ↓
    Start container
    ↓
    Add to createdContainers array
    ↓
NEXT replica
    ↓
Return success response with service URL
```

#### 2. Docker Event Listener Detects New Containers

```
Container starts
    ↓
Docker emits "start" event
    ↓
Event listener receives event
    ↓
Inspect container to get:
    • Container name
    • IP address from proxy network
    • Exposed ports
    • Labels (service name)
    ↓
Extract service name from label (or use container name)
    ↓
Check if service exists in DB:
    • If NO: Create new service entry
    • If YES: Add to existing targets
    ↓
Store: {
    ipAddress: "172.19.0.3",
    port: "80",
    containerId: "abc123..."
}
    ↓
Log: "Service 'web' now has 3 target(s)"
```

#### 3. User Makes a Request

```bash
curl -H "Host: web.localhost" http://localhost
```

**Request Flow:**

```
Request arrives at port 80
    ↓
Express middleware extracts hostname: "web.localhost"
    ↓
Split hostname to get subdomain: "web"
    ↓
Look up "web" in service database
    ↓
Service found? 
    ├─ NO → Return 404 "Service Not Found"
    └─ YES → Continue
    ↓
Get targets array for service "web": [
    {ip: "172.19.0.3", port: "80"},
    {ip: "172.19.0.4", port: "80"},
    {ip: "172.19.0.5", port: "80"}
]
    ↓
Get current round-robin index: 0
    ↓
Select target at index 0: 172.19.0.3:80
    ↓
Increment index: 0 → 1 (next request gets index 1)
    ↓
Proxy request to http://172.19.0.3:80
    ↓
Wait for response from nginx container
    ↓
Return response to user
```

**Round-Robin Example:**

```
Request 1 → Container 1 (172.19.0.3) [index: 0]
Request 2 → Container 2 (172.19.0.4) [index: 1]
Request 3 → Container 3 (172.19.0.5) [index: 2]
Request 4 → Container 1 (172.19.0.3) [index: 0] ← Loops back!
Request 5 → Container 2 (172.19.0.4) [index: 1]
...
```

#### 4. Container Stops/Dies

```
Container stops (or crashes)
    ↓
Docker emits "die" event
    ↓
Event listener receives event with containerId
    ↓
FOR each service in database:
    ↓
    Filter out targets matching containerId
    ↓
    If targets.length decreased:
        Log: "Removed container from service"
    ↓
    If targets.length === 0:
        Delete entire service from database
        Log: "Service removed (no targets)"
    ↓
NEXT service
```

---

## 💻 Code Breakdown

### 1. Dependencies & Initialization

```javascript
const http = require('http');           // Core HTTP server
const express = require('express');      // Web framework
const Docker = require('dockerode');     // Docker API client
const httpProxy = require('http-proxy'); // HTTP proxy library
```

**What each does:**
- `http`: Creates the HTTP server for reverse proxy
- `express`: Handles routing and middleware for Management API
- `dockerode`: Communicates with Docker daemon to manage containers
- `http-proxy`: Proxies HTTP requests to backend containers

```javascript
const docker = new Docker({ socketPath: '/var/run/docker.sock' });
```
**Critical:** Connects to Docker daemon via Unix socket. This requires mounting `/var/run/docker.sock` in docker-compose.

```javascript
const db = new Map();
```
**In-Memory Database Structure:**
```javascript
Map {
  "web" => {
    targets: [
      {ipAddress: "172.19.0.3", port: "80", containerId: "abc123"},
      {ipAddress: "172.19.0.4", port: "80", containerId: "def456"}
    ],
    index: 0  // Current round-robin position
  },
  "api" => {
    targets: [...],
    index: 1
  }
}
```

---

### 2. Docker Event Listener (Auto-Discovery)

```javascript
docker.getEvents(function (err, stream) {
    stream.on('data', async (chunk) => {
        const event = JSON.parse(chunk.toString());
```

**How it works:**
- Opens a persistent connection to Docker daemon
- Receives real-time events (container start, stop, die, etc.)
- Each event is a JSON object with Type and Action

**Example Event:**
```json
{
  "Type": "container",
  "Action": "start",
  "Actor": {
    "ID": "abc123def456...",
    "Attributes": {
      "name": "my-container"
    }
  }
}
```

#### Container Start Handler

```javascript
if (event.Type === "container" && event.Action === "start") {
    const container = docker.getContainer(event.Actor.ID);
    const containerInfo = await container.inspect();
```

**`container.inspect()` returns:**
```json
{
  "Name": "/my-container",
  "Config": {
    "ExposedPorts": {"80/tcp": {}},
    "Labels": {"service": "web"}
  },
  "NetworkSettings": {
    "Networks": {
      "reverse-proxy_proxy-net": {
        "IPAddress": "172.19.0.3"
      }
    }
  }
}
```

#### IP Address Detection

```javascript
const possibleNetworkNames = [
    'proxy-net',
    'reverse-proxy_proxy-net',
    'trafeik_proxy-net'
];

for (const name of possibleNetworkNames) {
    if (networks[name] && networks[name].IPAddress) {
        ipAddress = networks[name].IPAddress;
        networkName = name;
        break;
    }
}
```

**Why multiple names?**
- Docker Compose prefixes network names with project name
- Different compose file names create different prefixes
- Fallback ensures compatibility

#### Service Registration

```javascript
const labels = containerInfo.Config.Labels || {};
const serviceName = labels.service || containerName;
```

**Logic:**
1. Check if container has `service` label
2. If YES: Use label value as service name (enables grouping)
3. If NO: Use container name as service name

**Example:**
```javascript
// Container 1: name="web-1", label="service=web"  → service: "web"
// Container 2: name="web-2", label="service=web"  → service: "web" (same service!)
// Container 3: name="api-1", no label              → service: "api-1"
```

```javascript
if (!db.has(serviceName)) {
    db.set(serviceName, { targets: [], index: 0 });
}

db.get(serviceName).targets.push({
    ipAddress,
    port: defaultPort,
    containerId: event.Actor.ID
});
```

**Effect:**
- Multiple containers with same `service` label form one service
- Requests to that service are load-balanced across all targets

---

### 3. Container Stop Handler (Auto-Cleanup)

```javascript
if (event.Type === "container" && event.Action === "die") {
    const containerId = event.Actor.ID;
    
    for (const [serviceName, service] of db.entries()) {
        service.targets = service.targets.filter(t => t.containerId !== containerId);
        
        if (service.targets.length === 0) {
            db.delete(serviceName);
        }
    }
}
```

**What happens:**
1. Container dies/stops
2. Remove from ALL services (in case it was in multiple)
3. If service has no targets left, delete the service entirely

**Example:**
```
Before: web = [container1, container2, container3]
Container2 dies
After:  web = [container1, container3]

Before: api = [container4]
Container4 dies
After:  api service deleted entirely
```

---

### 4. Reverse Proxy Request Handler

```javascript
reverseProxyApp.use(function (req, res) {
    const hostName = req.hostname;         // "web.localhost"
    const subDomain = hostName.split(".")[0];  // "web"
```

**Subdomain Extraction:**
```
web.localhost       → "web"
api.localhost       → "api"
admin.localhost     → "admin"
my-app.localhost    → "my-app"
```

```javascript
if (!db.has(subDomain)) {
    return res.status(404).send("Service Not Found");
}
```

**404 Cases:**
- Service never existed
- Service had containers but they all died
- Typo in subdomain

```javascript
const service = db.get(subDomain);
const { targets } = service;

const targetInfo = targets[service.index];
service.index = (service.index + 1) % targets.length;
```

**Round-Robin Algorithm:**
```javascript
// Assume 3 targets (indices 0, 1, 2)
index = 0  →  select targets[0], then index = (0+1) % 3 = 1
index = 1  →  select targets[1], then index = (1+1) % 3 = 2
index = 2  →  select targets[2], then index = (2+1) % 3 = 0  ← Wraps!
```

The `% targets.length` ensures the index wraps around.

```javascript
const target = 'http://' + targetInfo.ipAddress + ':' + targetInfo.port;
return proxy.web(req, res, { target, changeOrigin: true, ws: true });
```

**Proxy Options:**
- `target`: Backend server URL (e.g., `http://172.19.0.3:80`)
- `changeOrigin: true`: Changes the origin header to match target (required for virtual hosts)
- `ws: true`: Enables WebSocket proxying

---

### 5. Management API - Create Containers

```javascript
managementAPI.post('/containers', async (req, res) => {
    const { image, tag = "latest", replicas = 1, service } = req.body;
```

**Request Example:**
```json
{
  "image": "nginx",
  "tag": "alpine",
  "replicas": 5,
  "service": "web"
}
```

#### Image Pull Logic

```javascript
const images = await docker.listImages();
let imageExists = false;

for (const systemImg of images) {
    for (const systemTag of systemImg.RepoTags) {
        if (systemTag === image + ':' + tag) {
            imageExists = true;
            break;
        }
    }
}

if (!imageExists) {
    const stream = await docker.pull(image + ':' + tag);
    await new Promise((resolve, reject) => {
        docker.modem.followProgress(stream, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}
```

**Why check first?**
- Pulling is slow (downloads from Docker Hub)
- If image exists locally, skip the pull
- `docker.pull()` returns a stream, so we wait for completion

#### Network Detection

```javascript
const networksList = await docker.listNetworks();
let proxyNetworkName = null;

for (const network of networksList) {
    if (network.Name.includes('proxy-net')) {
        proxyNetworkName = network.Name;
        break;
    }
}
```

**Finds the actual network name:**
- Could be `proxy-net`, `reverse-proxy_proxy-net`, `myproject_proxy-net`
- Uses `.includes()` to match any variant

#### Container Creation Loop

```javascript
for (let i = 0; i < replicas; i++) {
    const containerConfig = {
        Image: image + ':' + tag,
        Tty: false,
        HostConfig: {
            AutoRemove: true,
            NetworkMode: proxyNetworkName
        }
    };

    if (service) {
        containerConfig.Labels = { service: service };
    }

    const container = await docker.createContainer(containerConfig);
    await container.start();
}
```

**Key Points:**
- `AutoRemove: true`: Container auto-deletes when stopped (cleanup)
- `NetworkMode`: Attaches to proxy network (required for IP access)
- `Labels`: Groups containers under same service name

**What happens:**
1. Creates container (not started yet)
2. Starts container
3. Docker emits "start" event
4. Event listener registers it automatically
5. Repeat for each replica

---

### 6. Management API - List Services

```javascript
managementAPI.get('/services', (req, res) => {
    const services = Array.from(db.entries()).map(([name, service]) => ({
        name,
        url: 'http://' + name + '.localhost',
        targets: service.targets.map(t => ({
            ip: t.ipAddress,
            port: t.port,
            containerId: t.containerId.substring(0, 12)
        })),
        activeTargets: service.targets.length
    }));
    
    res.json({ services });
});
```

**Response Example:**
```json
{
  "services": [
    {
      "name": "web",
      "url": "http://web.localhost",
      "targets": [
        {"ip": "172.19.0.3", "port": "80", "containerId": "abc123def456"},
        {"ip": "172.19.0.4", "port": "80", "containerId": "def456ghi789"}
      ],
      "activeTargets": 2
    }
  ]
}
```

---

## 🚀 Installation & Usage

### Prerequisites

- Docker installed
- Docker Compose installed
- Node.js 18+ (only for development)

### Quick Start

```bash
# 1. Clone the repository
git clone <your-repo>
cd reverse-proxy

# 2. Start the reverse proxy
docker compose up -d

# 3. Create a service with 3 replicas
curl -X POST http://localhost:8080/containers \
  -H "Content-Type: application/json" \
  -d '{
    "image": "nginx",
    "replicas": 3,
    "service": "web"
  }'

# 4. Access the service
curl http://web.localhost

# 5. View logs to see round-robin
docker compose logs -f
```

### Project Structure

```
reverse-proxy/
├── index.js              # Main application
├── package.json          # Dependencies
├── docker-compose.yml    # Compose configuration
├── Dockerfile.dev        # Development Dockerfile
├── .dockerignore         # Docker ignore patterns
└── README.md             # This file
```

---

## 📖 API Documentation

### Management API (Port 8080)

#### POST `/containers` - Create Service

**Request:**
```json
{
  "image": "nginx",           // Required: Docker image name
  "tag": "latest",            // Optional: Image tag (default: "latest")
  "replicas": 3,              // Optional: Number of containers (default: 1)
  "service": "web"            // Optional: Service name for grouping
}
```

**Response (200 OK):**
```json
{
  "status": "success",
  "service": "web",
  "url": "http://web.localhost",
  "containers": ["container1", "container2", "container3"],
  "replicas": 3
}
```

**Example:**
```bash
# Single container
curl -X POST http://localhost:8080/containers \
  -H "Content-Type: application/json" \
  -d '{"image": "nginx"}'

# Multiple replicas
curl -X POST http://localhost:8080/containers \
  -H "Content-Type: application/json" \
  -d '{"image": "httpd", "replicas": 5, "service": "apache"}'
```

---

#### GET `/services` - List All Services

**Response (200 OK):**
```json
{
  "services": [
    {
      "name": "web",
      "url": "http://web.localhost",
      "targets": [
        {
          "ip": "172.19.0.3",
          "port": "80",
          "containerId": "abc123def456"
        }
      ],
      "activeTargets": 3
    }
  ]
}
```

**Example:**
```bash
curl http://localhost:8080/services

# With jq for pretty output
curl http://localhost:8080/services | jq
```

---

### Reverse Proxy (Port 80)

**Access Pattern:**
```
http://<service-name>.localhost
```

**Examples:**
```bash
# Access "web" service
curl http://web.localhost
curl -H "Host: web.localhost" http://localhost

# Access "api" service
curl http://api.localhost

# Access in browser
open http://web.localhost
```

---

## 🎯 Advanced Examples

### Example 1: Multi-Service Application

```bash
# Create frontend (3 replicas)
curl -X POST http://localhost:8080/containers \
  -H "Content-Type: application/json" \
  -d '{
    "image": "nginx",
    "replicas": 3,
    "service": "frontend"
  }'

# Create backend API (5 replicas)
curl -X POST http://localhost:8080/containers \
  -H "Content-Type: application/json" \
  -d '{
    "image": "my-api:latest",
    "replicas": 5,
    "service": "api"
  }'

# Create database (1 replica)
curl -X POST http://localhost:8080/containers \
  -H "Content-Type: application/json" \
  -d '{
    "image": "postgres:15",
    "replicas": 1,
    "service": "db"
  }'

# Access each service
curl http://frontend.localhost
curl http://api.localhost
curl http://db.localhost
```

---

### Example 2: Manual Container Management

```bash
# Create containers manually with service labels
docker run -d --rm \
  --name web-1 \
  --network reverse-proxy_proxy-net \
  --label service=web \
  nginx

docker run -d --rm \
  --name web-2 \
  --network reverse-proxy_proxy-net \
  --label service=web \
  nginx

# Both containers are now load-balanced under "web" service
curl http://web.localhost
```

---

### Example 3: Zero-Downtime Deployment

```bash
# Current: 3 old containers running

# Step 1: Create 3 new containers with new version
curl -X POST http://localhost:8080/containers \
  -H "Content-Type: application/json" \
  -d '{
    "image": "myapp:v2",
    "replicas": 3,
    "service": "app"
  }'

# Now: 6 containers running (3 old + 3 new)
# Traffic automatically distributes across all 6

# Step 2: Stop old containers
docker stop app-old-1 app-old-2 app-old-3

# Now: Only 3 new containers serving traffic
# No downtime!
```

---

### Example 4: Testing Load Balancing

```bash
# Terminal 1: Watch logs
docker compose logs -f

# Terminal 2: Send requests
for i in {1..10}; do
  echo "Request $i:"
  curl -s http://web.localhost | grep "<title>"
  sleep 0.5
done
```

**Expected logs:**
```
Proxying request for web.localhost to http://172.19.0.3:80 [1/3]
Proxying request for web.localhost to http://172.19.0.4:80 [2/3]
Proxying request for web.localhost to http://172.19.0.5:80 [3/3]
Proxying request for web.localhost to http://172.19.0.3:80 [1/3]  ← Round-robin!
```

---

### Example 5: Load Testing

```bash
# Install Apache Bench
# macOS: brew install httpd
# Ubuntu: sudo apt-get install apache2-utils

# Send 10,000 requests with 100 concurrent connections
ab -n 10000 -c 100 -H "Host: web.localhost" http://localhost/

# Results will show:
# - Requests per second
# - Time per request
# - Distribution across percentiles
```

---

## 🐛 Troubleshooting

### Container Not Accessible (404)

**Symptom:** `curl http://web.localhost` returns 404

**Diagnosis:**
```bash
# Check if service is registered
curl http://localhost:8080/services

# Check if containers are running
docker ps --filter label=service=web

# Check container network
docker inspect <container-name> | grep -A 10 "Networks"
```

**Solution:**
```bash
# Ensure containers are on proxy network
docker run -d --rm \
  --name test \
  --network reverse-proxy_proxy-net \
  --label service=test \
  nginx
```

---

### Empty IP Address in Logs

**Symptom:** `Registering web.localhost --> http://:80`

**Cause:** Network name mismatch

**Solution:**
```bash
# Clean everything
docker compose down
docker rm -f $(docker ps -aq)
docker network rm proxy-net reverse-proxy_proxy-net

# Rebuild
docker compose build --no-cache
docker compose up -d
```

---

### Proxy Request Hangs

**Symptom:** Request never completes, just hangs

**Diagnosis:**
```bash
# Check if you can reach container directly
docker exec reverse-proxy-reverse-proxy-1 wget -O- http://172.19.0.3:80

# Check proxy logs
docker compose logs -f | grep "Proxy error"
```

**Common Causes:**
1. Containers on wrong network
2. Firewall blocking inter-container communication
3. Container not actually running

---

### Port Conflicts

**Symptom:** `Error: bind: address already in use`

**Solution:**
```bash
# Find what's using port 80
lsof -i :80

# Kill the process
kill -9 <PID>

# Or change ports in docker-compose.yml
ports:
  - "8080:80"  # Access via localhost:8080
```

---

## 📊 Performance Considerations

### Round-Robin vs Other Algorithms

**Round-Robin (What we use):**
- ✅ Simple and fair
- ✅ Works well when all containers are identical
- ❌ Doesn't consider container load
- ❌ Doesn't consider response times

**Alternatives (not implemented):**
- **Least Connections:** Route to container with fewest active connections
- **Weighted Round-Robin:** Give more traffic to powerful servers
- **IP Hash:** Same client always goes to same server (sticky sessions)
- **Random:** Randomly select a target

### Scaling Limits

This implementation can handle:
- ✅ 100s of services
- ✅ 1000s of containers
- ✅ 10,000s requests/second (with proper hardware)

**Bottlenecks:**
1. **In-Memory DB:** No persistence, lost on restart
2. **Single Node:** No distributed load balancing
3. **No Health Checks:** Dead containers still receive traffic until removed

### Production Improvements

For production use, consider:

1. **Persistent Storage:** Use Redis for service registry
2. **Health Checks:** Ping containers before routing
3. **Metrics:** Add Prometheus metrics
4. **SSL/TLS:** HTTPS support with Let's Encrypt
5. **Rate Limiting:** Prevent abuse
6. **Caching:** Cache responses for static content
7. **Compression:** Gzip responses
8. **Logging:** Structured logging with Winston

---

## 🔐 Security Considerations

### Current Security

✅ **Isolated Network:** Containers on private network  
✅ **No Direct Access:** Containers not exposed to internet  
⚠️ **No Authentication:** Management API is open  
⚠️ **No Rate Limiting:** Vulnerable to DoS  
⚠️ **HTTP Only:** No encryption  

### Production Hardening

```javascript
// 1. Add API authentication
const apiKey = process.env.API_KEY;
managementAPI.use((req, res, next) => {
    if (req.headers['x-api-key'] !== apiKey) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
});

// 2. Add rate limiting
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
managementAPI.use(limiter);

// 3. Add HTTPS
const https = require('https');
const fs = require('fs');
const options = {
    key: fs.readFileSync('key.pem'),
    cert: fs.readFileSync('cert.pem')
};
https.createServer(options, reverseProxyApp).listen(443);
```

---

## 🎓 Learning Resources

### Concepts

- [What is a Reverse Proxy?](https://www.cloudflare.com/learning/cdn/glossary/reverse-proxy/)
- [Load Balancing Algorithms](https://www.nginx.com/resources/glossary/load-balancing/)
- [Docker Networking](https://docs.docker.com/network/)

### Libraries

- [Dockerode Documentation](https://github.com/apocas/dockerode)
- [HTTP Proxy Middleware](https://github.com/http-party/node-http-proxy)
- [Express.js Guide](https://expressjs.com/en/guide/routing.html)

---

## 📝 License

MIT License - Feel free to use this in your projects!

---

## 🙏 Acknowledgments

Built with:
- Node.js
- Express
- Dockerode
- http-proxy

Inspired by production reverse proxies like:
- Traefik
- Nginx
- HAProxy
- Envoy

---

## 📧 Support

Having issues? Check:
1. Docker daemon is running: `docker ps`
2. Ports 80 and 8080 are free: `lsof -i :80`
3. Docker socket is mounted: `docker compose config`
4. Containers are on proxy network: `docker network inspect reverse-proxy_proxy-net`

Still stuck? Open an issue on GitHub!

---

**Happy Load Balancing! 🚀**
