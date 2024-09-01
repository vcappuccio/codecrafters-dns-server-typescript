import * as dgram from "dgram";
import { argv } from "process";

const PORT = 2053;
const udpSocket: dgram.Socket = dgram.createSocket("udp4");
const resolverAddress = (argv[2] || "8.8.8.8:53").split(":");
const resolverIP = resolverAddress[0];
const resolverPort = parseInt(resolverAddress[1], 10);

console.log(`[${new Date().toISOString()}] Socket created`);

udpSocket.bind(PORT, "127.0.0.1", () => {
    console.log(`[${new Date().toISOString()}] Socket bound to 127.0.0.1:${PORT}`);
});

udpSocket.on("listening", () => {
    const address = udpSocket.address();
    console.log(`[${new Date().toISOString()}] Server listening on ${address.address}:${address.port}`);
});

udpSocket.on("message", (data: Buffer, remoteAddr: dgram.RemoteInfo) => {
    try {
        console.log(`[${new Date().toISOString()}] Received data from ${remoteAddr.address}:${remoteAddr.port}`);
        console.log(`[${new Date().toISOString()}] Data: ${data.toString('hex')}`);

        const resolverSocket = dgram.createSocket("udp4");
        resolverSocket.send(data, resolverPort, resolverIP, (err) => {
            if (err) {
                console.log(`[${new Date().toISOString()}] Error forwarding data: ${err}`);
            } else {
                console.log(`[${new Date().toISOString()}] Data forwarded to resolver`);
            }
        });

        resolverSocket.on("message", (resolverResponse: Buffer) => {
            console.log(`[${new Date().toISOString()}] Received response from resolver: ${resolverResponse.toString('hex')}`);
            udpSocket.send(resolverResponse, 0, resolverResponse.length, remoteAddr.port, remoteAddr.address, (err) => {
                if (err) {
                    console.log(`[${new Date().toISOString()}] Error sending data: ${err}`);
                } else {
                    console.log(`[${new Date().toISOString()}] Response sent to ${remoteAddr.address}:${remoteAddr.port}`);
                }
            });
            resolverSocket.close();
        });

    } catch (e) {
        console.log(`[${new Date().toISOString()}] Error processing message: ${e}`);
    }
});

udpSocket.on("error", (err) => {
    console.log(`[${new Date().toISOString()}] Socket error: ${err}`);
    udpSocket.close();
});

udpSocket.on("close", () => {
    console.log(`[${new Date().toISOString()}] Socket closed`);
});

setInterval(() => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Server is running...`);
}, 5000);