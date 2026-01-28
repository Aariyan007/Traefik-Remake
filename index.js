const http = require('http');
const express = require('express');
const Docker = require('dockerode');
const httpProxy = require('http-proxy');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const db = new Map();
const proxy = httpProxy.createProxyServer({});

proxy.on('error', (err, req, res) => {
    console.error('Proxy error:', err.message);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end("Proxy error");
});

docker.getEvents(function (err, stream) {
    if (err) {
        console.log("Error in getting docker events:", err);
        return;
    }
    
    stream.on('data', async (chunk) => {
        if (!chunk) return;
        
        const event = JSON.parse(chunk.toString());
        
        if (event.Type === "container" && event.Action === "start") {
            const container = docker.getContainer(event.Actor.ID);
            const containerInfo = await container.inspect();
            const containerName = containerInfo.Name.substring(1);
            
            const networks = containerInfo.NetworkSettings.Networks;
            console.log('Container ' + containerName + ' networks:', Object.keys(networks));
            
            let ipAddress = null;
            let networkName = null;
            
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
            
            if (!ipAddress) {
                for (const [name, network] of Object.entries(networks)) {
                    if (network.IPAddress) {
                        ipAddress = network.IPAddress;
                        networkName = name;
                        break;
                    }
                }
            }
            
            if (!ipAddress) {
                console.log('Warning: No IP address found for container ' + containerName);
                console.log('Available networks:', JSON.stringify(networks, null, 2));
                return;
            }
            
            const exposedPorts = containerInfo.Config.ExposedPorts;
            let defaultPort = null;
            
            if (exposedPorts) {
                const portKey = Object.keys(exposedPorts)[0];
                if (portKey) {
                    defaultPort = portKey.split("/")[0];
                }
            }
            
            console.log('Registering ' + containerName + '.localhost --> http://' + ipAddress + ':' + defaultPort + ' (network: ' + networkName + ')');
            
            db.set(containerName, {
                ipAddress,
                defaultPort
            });
        }
    });
});

const reverseProxyApp = express();

reverseProxyApp.use(function (req, res) {
    const hostName = req.hostname;
    const subDomain = hostName.split(".")[0];
    
    if (!db.has(subDomain)) {
        console.log('Container not found for subdomain: ' + subDomain);
        return res.status(404).send("Container Not Found");
    }
    
    const { ipAddress, defaultPort } = db.get(subDomain);
    
    if (!defaultPort) {
        console.log('No exposed port for container: ' + subDomain);
        return res.status(502).send("No exposed port");
    }
    
    const target = 'http://' + ipAddress + ':' + defaultPort;
    console.log('Proxying request for ' + hostName + ' to ' + target);
    
    return proxy.web(req, res, { target, changeOrigin: true, ws: true });
});

const reverseProxy = http.createServer(reverseProxyApp);

const managementAPI = express();
managementAPI.use(express.json());

managementAPI.post('/containers', async (req, res) => {
    try {
        const { image, tag = "latest" } = req.body;
        
        if (!image) {
            return res.status(400).json({ error: "Image name is required" });
        }
        
        const images = await docker.listImages();
        let imageExists = false;
        
        for (const systemImg of images) {
            if (!systemImg.RepoTags) continue;
            for (const systemTag of systemImg.RepoTags) {
                if (systemTag === image + ':' + tag) {
                    imageExists = true;
                    break;
                }
            }
            if (imageExists) break;
        }
        
        if (!imageExists) {
            console.log('Pulling image: ' + image + ':' + tag);
            const stream = await docker.pull(image + ':' + tag);
            await new Promise((resolve, reject) => {
                docker.modem.followProgress(stream, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
        
        const networksList = await docker.listNetworks();
        let proxyNetworkName = null;
        
        for (const network of networksList) {
            if (network.Name.includes('proxy-net')) {
                proxyNetworkName = network.Name;
                break;
            }
        }
        
        if (!proxyNetworkName) {
            console.error('proxy-net network not found!');
            return res.status(500).json({ error: "Proxy network not found" });
        }
        
        console.log('Using network: ' + proxyNetworkName);
        
        const container = await docker.createContainer({
            Image: image + ':' + tag,
            Tty: false,
            HostConfig: {
                AutoRemove: true,
                NetworkMode: proxyNetworkName
            }
        });
        
        await container.start();
        
        const containerInfo = await container.inspect();
        const containerName = containerInfo.Name.substring(1);
        
        return res.json({
            status: "success",
            container: containerName + '.localhost',
            url: 'http://' + containerName + '.localhost'
        });
        
    } catch (error) {
        console.error('Error creating container:', error);
        return res.status(500).json({ 
            error: error.message 
        });
    }
});

managementAPI.get('/containers', (req, res) => {
    const containers = Array.from(db.entries()).map(([name, info]) => ({
        name,
        url: 'http://' + name + '.localhost',
        target: 'http://' + info.ipAddress + ':' + info.defaultPort
    }));
    
    res.json({ containers });
});

managementAPI.listen(8080, () => {
    console.log("Management API listening on port 8080");
});

reverseProxy.listen(80, () => {
    console.log("Reverse Proxy listening on port 80");
});