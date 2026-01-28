const http = require('http');
const express = require('express');
const Docker = require('dockerode');
const { stat } = require('fs');

const docker = new Docker({socketPath: '/var/run/docker.sock'});

const managementAPI = express();

managementAPI.use(express.json());

managementAPI.post('/containers',async (req,res)=>{
    const {image,tag = "latest"} = req.body;

    const images = await docker.listImages();

    let isExsist = false;
    
    for(const systemImg of images){
        for(const systemTag of systemImg.RepoTags){
            if (systemTag === `${image}:${tag}`){
                isExsist = true;
                break;
            }
        }

        if(imagesExsist) break;
    }

    if(!isExsist){
        console.log(`Pulling image: ${image}:${tag}`);
        await docker.pull(`${image}:${tag}`);
    }

    const container = await docker.createContainer({
        Image: `${image}:${tag}`,
        Tty: false,
        HostConfig:{
            AutoRemove:true,
        }
    })
    await container.start();

    return res.json({
        status: "success",
        container: `${(await container.inspect()).Name}.localhost`
    })

})