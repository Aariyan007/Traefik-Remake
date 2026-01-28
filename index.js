const http = require('http');
const express = require('express');
const Docker = require('dockerode');
const { stat } = require('fs');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const db  = new Map();


docker.getEvents(function (err, stream) {
    if (err) {
        console.log("Error in getting docker events:", err);
        return;
    }

    stream.on('data', async (chunck) => {
        if (!chunck) return;
        const event = JSON.parse(chunck.toString());

        if (event.Type === "container" && event.Action === "start") {
            const container = docker.getContainer(event.Actor.ID);
            const containerInfo = await container.inspect();

            const containerName = containerInfo.Name.substring(1);
            const ipAddress = containerInfo.NetworkSettings.IPAddress;

            const exposedPort = containerInfo.Config.ExposedPorts;

            let defaultPort = null;

            if (exposedPort && exposedPort.length > 0) {
                const [port, type] = exposedPort[0].split("/");
                if (type === "tcp") {
                    defaultPort = port;
                }
            }
            console.log(`Registering ${containerName}.localhost --> http://${ipAddress}:${defaultPort}`);
            db.set(containerName,ipAddress,defaultPort);
        }
    })

})

const managementAPI = express();

managementAPI.use(express.json());

managementAPI.post('/containers', async (req, res) => {
    const { image, tag = "latest" } = req.body;

    const images = await docker.listImages();

    let isExsist = false;

    for (const systemImg of images) {
        for (const systemTag of systemImg.RepoTags) {
            if (systemTag === `${image}:${tag}`) {
                isExsist = true;
                break;
            }
        }

        if (isExsist) break;
    }

    if (!isExsist) {
        console.log(`Pulling image: ${image}:${tag}`);
        await docker.pull(`${image}:${tag}`);
    }

    const container = await docker.createContainer({
        Image: `${image}:${tag}`,
        Tty: false,
        HostConfig: {
            AutoRemove: true,
        }
    })
    await container.start();

    return res.json({
        status: "success",
        container: `${(await container.inspect()).Name}.localhost`
    })

})

managementAPI.listen(8080, () => {
    console.log("Management API listening on port 8080");
})