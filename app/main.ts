import * as dgram from 'dgram';
import { argv } from 'process';

const PORT = 2053;
const udpSocket: dgram.Socket = dgram.createSocket('udp4');
const resolverAddress = (argv[2] || '8.8.8.8:53').split(':');
const resolverIP = resolverAddress[0];
const resolverPort = resolverAddress[1] ? parseInt(resolverAddress[1], 10) : 53;

if (isNaN(resolverPort) || resolverPort < 0 || resolverPort > 65535) {
    throw new Error(`Invalid Port: ${resolverPort}. Ports must be >= 0 and <= 65535.`);
}

console.log('Logs from your program will appear here!');

udpSocket.bind(PORT, '127.0.0.1', () => {
    console.log(`[${new Date().toISOString()}] Socket bound to 127.0.0.1:${PORT}`);
});

udpSocket.on('listening', () => {
    const address = udpSocket.address();
    console.log(`[${new Date().toISOString()}] Server listening on ${address.address}:${address.port}`);
});

udpSocket.on('message', (data: Buffer, remoteAddr: dgram.RemoteInfo) => {
    try {
        console.log(`[${new Date().toISOString()}] Received data from ${remoteAddr.address}:${remoteAddr.port}`);
        console.log(`[${new Date().toISOString()}] Data: ${data.toString('hex')}`);

        if (data.length < 12) {
            throw new Error('Invalid DNS message: too short');
        }

        const id = data.readUInt16BE(0); // Read ID from request
        const flags = data.readUInt16BE(2); // Read flags from request
        const opcode = (flags >> 11) & 0x0F; // Extract OPCODE
        const rd = (flags >> 8) & 0x01; // Extract RD
        const rcode = opcode === 0 ? 0 : 4; // Set RCODE based on OPCODE

        const header = Buffer.alloc(12);
        header.writeUInt16BE(id, 0); // Mimic ID from request
        header.writeUInt16BE(0x8000 | (opcode << 11) | (rd << 8) | rcode, 2); // Set response flags
        header.writeUInt16BE(2, 4); // QDCOUNT
        header.writeUInt16BE(2, 6); // ANCOUNT
        header.writeUInt16BE(0, 8); // NSCOUNT
        header.writeUInt16BE(0, 10); // ARCOUNT

        // Parse question section
        let offset = 12;
        const questions = [];
        while (offset < data.length) {
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

        // Create question section for response
        const questionSection = Buffer.concat(questions.map(question => {
            const labels = question.name.split('.');
            const questionBuffer = Buffer.alloc(question.name.length + 6 + labels.length);
            let offset = 0;
            labels.forEach(label => {
                questionBuffer.writeUInt8(label.length, offset);
                offset += 1;
                questionBuffer.write(label, offset);
                offset += label.length;
            });
            questionBuffer.writeUInt8(0, offset); // Null byte to end the name
            offset += 1;
            questionBuffer.writeUInt16BE(1, offset); // Type A
            questionBuffer.writeUInt16BE(1, offset + 2); // Class IN
            return questionBuffer;
        }));

        // Create answer section
        const answerSection = Buffer.concat(questions.map(question => {
            const labels = question.name.split('.');
            const answerBuffer = Buffer.alloc(question.name.length + 16 + labels.length);
            let offset = 0;
            labels.forEach(label => {
                answerBuffer.writeUInt8(label.length, offset);
                offset += 1;
                answerBuffer.write(label, offset);
                offset += label.length;
            });
            answerBuffer.writeUInt8(0, offset); // Null byte to end the name
            offset += 1;
            answerBuffer.writeUInt16BE(1, offset); // Type A
            answerBuffer.writeUInt16BE(1, offset + 2); // Class IN
            answerBuffer.writeUInt32BE(60, offset + 4); // TTL
            answerBuffer.writeUInt16BE(4, offset + 8); // Data length
            answerBuffer.writeUInt32BE(0x08080808, offset + 10); // Address 8.8.8.8
            return answerBuffer;
        }));

        const response = Buffer.concat([header, questionSection, answerSection]);

        console.log(`[${new Date().toISOString()}] Sending response: ${response.toString('hex')}`);

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

udpSocket.on('error', (err) => {
    console.log(`[${new Date().toISOString()}] Socket error: ${err}`);
    udpSocket.close();
});

udpSocket.on('close', () => {
    console.log(`[${new Date().toISOString()}] Socket closed`);
});

setInterval(() => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Server is running...`);
}, 5000);

function parseDomainName(buffer: Buffer, offset: number): { name: string, newOffset: number } {
    const labels: string[] = [];
    let currentOffset = offset;
    
    while (true) {
        const length = buffer[currentOffset];
        
        if (length === 0) {
            currentOffset++;
            break;
        }
        
        if ((length & 0xc0) === 0xc0) {
            // This is a pointer
            const pointerOffset = ((length & 0x3f) << 8) | buffer[currentOffset + 1];
            const { name } = parseDomainName(buffer, pointerOffset);
            labels.push(name);
            currentOffset += 2;
            break;
        }
        
        const label = buffer.slice(currentOffset + 1, currentOffset + 1 + length).toString();
        labels.push(label);
        currentOffset += length + 1;
    }
    
    return { name: labels.join('.'), newOffset: currentOffset };
}

function compressDomainName(name: string, buffer: Buffer, offset: number, nameOffsets: Map<string, number>): number {
    const labels = name.split('.');
    let currentOffset = offset;

    for (const label of labels) {
        const fullName = labels.slice(labels.indexOf(label)).join('.');
        if (nameOffsets.has(fullName)) {
            const pointer = nameOffsets.get(fullName)! | 0xc000;
            buffer.writeUInt16BE(pointer, currentOffset);
            return currentOffset + 2;
        }

        nameOffsets.set(fullName, currentOffset);
        buffer.writeUInt8(label.length, currentOffset);
        buffer.write(label, currentOffset + 1);
        currentOffset += label.length + 1;
    }

    buffer.writeUInt8(0, currentOffset);
    return currentOffset + 1;
}