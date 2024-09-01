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

        if (data.length < 12) {
            throw new Error("Invalid DNS message: too short");
        }

        const id = data.readUInt16BE(0); // Read ID from request
        const flags = data.readUInt16BE(2); // Read flags from request
        const opcode = (flags >> 11) & 0x0F; // Extract OPCODE
        const rd = (flags >> 8) & 0x01; // Extract RD
        const rcode = opcode === 0 ? 0 : 4; // Set RCODE based on OPCODE

        const header = Buffer.alloc(12);
        header.writeUInt16BE(id, 0); // Mimic ID from request
        header.writeUInt16BE(0x8000 | (opcode << 11) | (rd << 8) | rcode, 2); // Set response flags
        header.writeUInt16BE(1, 4); // QDCOUNT
        header.writeUInt16BE(1, 6); // ANCOUNT
        header.writeUInt16BE(0, 8); // NSCOUNT
        header.writeUInt16BE(0, 10); // ARCOUNT

        // Parse question section
        let offset = 12;
        const questions = [];
        for (let i = 0; i < 2; i++) {
            const labels = [];
            while (data[offset] !== 0) {
                const length = data[offset];
                labels.push(data.slice(offset + 1, offset + 1 + length).toString());
                offset += length + 1;
            }
            offset += 1; // Skip the null byte
            const name = labels.join('.');
            const type = data.readUInt16BE(offset);
            const qclass = data.readUInt16BE(offset + 2);
            offset += 4;
            questions.push({ name, type, qclass });
        }

        // Create a simple answer section
        const answers = questions.map(question => {
            const answer = Buffer.alloc(16 + question.name.length + 2);
            let offset = 0;
            const labels = question.name.split('.');
            labels.forEach(label => {
                answer.writeUInt8(label.length, offset);
                offset += 1;
                answer.write(label, offset);
                offset += label.length;
            });
            answer.writeUInt8(0, offset); // Null byte to end the name
            offset += 1;
            answer.writeUInt16BE(1, offset); // Type A
            answer.writeUInt16BE(1, offset + 2); // Class IN
            answer.writeUInt32BE(60, offset + 4); // TTL
            answer.writeUInt16BE(4, offset + 8); // Data length
            answer.writeUInt32BE(0x08080808, offset + 10); // Address 8.8.8.8
            return answer;
        });

        const response = Buffer.concat([header, ...questions.map(q => Buffer.from(q.name)), ...answers]);

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