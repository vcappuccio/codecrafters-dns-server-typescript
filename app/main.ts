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

        const header = Buffer.alloc(12);
        header.writeUInt16BE(1234, 0); // ID
        header.writeUInt16BE(0x8180, 2); // Flags
        header.writeUInt16BE(1, 4); // QDCOUNT
        header.writeUInt16BE(1, 6); // ANCOUNT
        header.writeUInt16BE(0, 8); // NSCOUNT
        header.writeUInt16BE(0, 10); // ARCOUNT

        const question = Buffer.from([
            0x0c, 0x63, 0x6f, 0x64, 0x65, 0x63, 0x72, 0x61, 0x66, 0x74, 0x65, 0x72, 0x73, 0x02, 0x69, 0x6f, 0x00, // Name: codecrafters.io
            0x00, 0x01, // Type: A
            0x00, 0x01  // Class: IN
        ]);

        const answer = Buffer.alloc(16);
        answer.writeUInt16BE(0xc00c, 0); // Name: codecrafters.io (compressed)
        answer.writeUInt16BE(1, 2); // Type: A
        answer.writeUInt16BE(1, 4); // Class: IN
        answer.writeUInt32BE(60, 6); // TTL
        answer.writeUInt16BE(4, 10); // Length
        answer.writeUInt32BE(0x08080808, 12); // Data: 8.8.8.8

        const response = Buffer.concat([header, question, answer]);

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