const express = require('express');
const router = express.Router();
const WebSocket = require('ws');
const { db } = require('../../../handlers/db.js');
const { isUserAuthorizedForContainer } = require('../../../utils/authHelper');

router.ws("/stats/:id", async (ws, req) => {
    try {
        // Validate user authentication
        if (!req.user) {
            ws.close(1008, "Authorization required");
            return;
        }

        // Validate parameters
        const { id } = req.params;
        if (!id) {
            ws.close(1008, "Instance ID required");
            return;
        }

        // Get instance data
        const instance = await db.get(`${id}_instance`);
        if (!instance) {
            ws.close(1008, "Instance not found");
            return;
        }

        // Check authorization
        const isAuthorized = await isUserAuthorizedForContainer(req.user.userId, instance.Id);
        if (!isAuthorized) {
            ws.close(1008, "Unauthorized access");
            return;
        }

        // Validate node data
        if (!instance.Node || !instance.Node.address || !instance.Node.port) {
            ws.close(1011, "Invalid node configuration");
            return;
        }

        if (!instance.ContainerId || !instance.VolumeId) {
            ws.close(1011, "Invalid container configuration");
            return;
        }

        // Create connection to node WebSocket
        const socket = new WebSocket(
            `ws://${instance.Node.address}:${instance.Node.port}/stats/${instance.ContainerId}/${instance.VolumeId}`
        );

        // Handle socket events
        socket.on('open', () => {
            try {
                socket.send(JSON.stringify({ 
                    event: "auth", 
                    args: [instance.Node.apiKey] 
                }));
            } catch (err) {
                console.error('Error sending auth:', err);
                ws.close(1011, 'Authentication failed');
            }
        });

        socket.on('message', (msg) => {
            try {
                if (ws.readyState === ws.OPEN) {
                    ws.send(msg);
                }
            } catch (err) {
                console.error('Error forwarding message:', err);
            }
        });

        socket.on('error', (error) => {
            console.error('Socket error:', error);
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ 
                    error: 'Stats service is temporarily unavailable' 
                }));
            }
        });

        socket.on('close', (event) => {
            if (ws.readyState === ws.OPEN) {
                ws.close(1011, 'Stats service disconnected');
            }
        });

        // Handle client WebSocket events
        ws.on('message', (msg) => {
            try {
                if (socket.readyState === socket.OPEN) {
                    socket.send(msg);
                }
            } catch (err) {
                console.error('Error sending message to node:', err);
            }
        });

        ws.on('close', () => {
            if (socket.readyState === socket.OPEN) {
                socket.close();
            }
        });

        ws.on('error', (err) => {
            console.error('Client WebSocket error:', err);
            if (socket.readyState === socket.OPEN) {
                socket.close();
            }
        });

    } catch (err) {
        console.error('Unexpected error in WebSocket handler:', err);
        if (ws.readyState === ws.OPEN) {
            ws.close(1011, 'Internal server error');
        }
    }
});

module.exports = router;