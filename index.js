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

            const labels = containerInfo.Config.Labels || {};
            const serviceName = labels.service || containerName;

            if (!db.has(serviceName)) {
                db.set(serviceName, { targets: [], index: 0 });
            }

            db.get(serviceName).targets.push({
                ipAddress,
                port: defaultPort,
                containerId: event.Actor.ID
            });

            console.log('Service "' + serviceName + '" now has ' + db.get(serviceName).targets.length + ' target(s)');
        }

        if (event.Type === "container" && event.Action === "die") {
            const containerId = event.Actor.ID;

            for (const [serviceName, service] of db.entries()) {
                const initialLength = service.targets.length;
                service.targets = service.targets.filter(t => t.containerId !== containerId);

                if (service.targets.length < initialLength) {
                    console.log('Removed container from service "' + serviceName + '", ' + service.targets.length + ' target(s) remaining');
                }

                if (service.targets.length === 0) {
                    db.delete(serviceName);
                    console.log('Service "' + serviceName + '" removed (no targets)');
                }
            }
        }
    });
});

const reverseProxyApp = express();

reverseProxyApp.use(function (req, res) {
    const hostName = req.hostname;
    const subDomain = hostName.split(".")[0];

    if (!db.has(subDomain)) {
        console.log('Service not found for subdomain: ' + subDomain);
        return res.status(404).send("Service Not Found");
    }
    const service = db.get(subDomain);
    const { targets } = service;
    if (!targets.length) {
        console.log('No available targets for service: ' + subDomain);
        return res.status(502).send("No available targets");
    }

    const targetInfo = targets[service.index];
    service.index = (service.index + 1) % targets.length;
    const target = 'http://' + targetInfo.ipAddress + ':' + targetInfo.port;
    console.log('Proxying request for ' + hostName + ' to ' + target + ' [' + (service.index === 0 ? targets.length : service.index) + '/' + targets.length + ']');

    return proxy.web(req, res, { target, changeOrigin: true, ws: true });
});

const reverseProxy = http.createServer(reverseProxyApp);

const managementAPI = express();
managementAPI.use(express.json());

managementAPI.post('/containers', async (req, res) => {
    try {
        const { image, tag = "latest", replicas = 1, service } = req.body;

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

        const createdContainers = [];
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

            const containerInfo = await container.inspect();
            const containerName = containerInfo.Name.substring(1);
            createdContainers.push(containerName);
        }

        const serviceName = service || createdContainers[0];

        return res.json({
            status: "success",
            service: serviceName,
            url: 'http://' + serviceName + '.localhost',
            containers: createdContainers,
            replicas: replicas
        });

    } catch (error) {
        console.error('Error creating container:', error);
        return res.status(500).json({
            error: error.message
        });
    }
});

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

managementAPI.listen(8080, () => {
    console.log("Management API listening on port 8080");
});

reverseProxy.listen(80, () => {
    console.log("Reverse Proxy listening on port 80");
});