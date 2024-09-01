import * as dgram from "dgram";
import { argv } from "process";

const PORT = 2053;
const udpSocket: dgram.Socket = dgram.createSocket("udp4");
const resolverAddress = (argv[2] || "8.8.8.8:53").split(":");
const resolverIP = resolverAddress[0];
const resolverPort = resolverAddress[1] ? parseInt(resolverAddress[1], 10) : 53;

if (isNaN(resolverPort) || resolverPort < 0 || resolverPort > 65535) {
    throw new Error(`Invalid Port: ${resolverPort}. Ports must be >= 0 and <= 65535.`);
}

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

        const id = data.readUInt16BE(0);
        const flags = data.readUInt16BE(2);
        const opcode = (flags >> 11) & 0x0F;
        const rd = (flags >> 8) & 0x01;
        const rcode = opcode === 0 ? 0 : 4;

        const header = Buffer.alloc(12);
        header.writeUInt16BE(id, 0); // ID
        header.writeUInt16BE(0x8000 | (opcode << 11) | (rd << 8) | rcode, 2); // Flags
        header.writeUInt16BE(1, 4); // QDCOUNT
        header.writeUInt16BE(1, 6); // ANCOUNT
        header.writeUInt16BE(0, 8); // NSCOUNT
        header.writeUInt16BE(0, 10); // ARCOUNT

        const response = Buffer.concat([header]);

        udpSocket.send(response, 0, response.length, remoteAddr.port, remoteAddr.address, (err) => {
            if (err) {
                console.log(`[${new Date().toISOString()}] Error sending data: ${err}`);
            } else {
                console.log(`[${new Date().toISOString()}] Response sent to ${remoteAddr.address}:${remoteAddr.port}`);
            }
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