import * as dgram from 'dgram';
import { argv } from 'process';

const PORT = 2053;
const udpSocket: dgram.Socket = dgram.createSocket('udp4');

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

udpSocket.on('message', (data: Buffer, remoteAddr: dgram.RemoteInfo) => {
    try {
        console.log(`[${new Date().toISOString()}] Received data from ${remoteAddr.address}:${remoteAddr.port}`);
        console.log(`[${new Date().toISOString()}] Data: ${data.toString('hex')}`);

        const id = data.readUInt16BE(0);
        const flags = data.readUInt16BE(2);
        const qdcount = data.readUInt16BE(4);

        const header = Buffer.alloc(12);
        header.writeUInt16BE(id, 0);
        header.writeUInt16BE(0x8180, 2); // QR=1, Opcode=0, AA=0, TC=0, RD=1, RA=1, Z=0, RCODE=0
        header.writeUInt16BE(qdcount, 4);
        header.writeUInt16BE(qdcount, 6); // ANCOUNT
        header.writeUInt16BE(0, 8);
        header.writeUInt16BE(0, 10);

        let offset = 12;
        const questions = [];
        for (let i = 0; i < qdcount; i++) {
            const { name, newOffset } = parseDomainName(data, offset);
            offset = newOffset;
            const type = data.readUInt16BE(offset);
            const qclass = data.readUInt16BE(offset + 2);
            offset += 4;
            questions.push({ name, type, qclass });
        }

        const questionSection = Buffer.concat(questions.map(question => {
            const labels = question.name.split('.');
            const questionBuffer = Buffer.alloc(question.name.length + 6 + labels.length);
            let qOffset = 0;
            labels.forEach(label => {
                questionBuffer.writeUInt8(label.length, qOffset);
                qOffset += 1;
                questionBuffer.write(label, qOffset);
                qOffset += label.length;
            });
            questionBuffer.writeUInt8(0, qOffset);
            qOffset += 1;
            questionBuffer.writeUInt16BE(question.type, qOffset);
            questionBuffer.writeUInt16BE(question.qclass, qOffset + 2);
            return questionBuffer;
        }));

        const answerSection = Buffer.concat(questions.map(question => {
            const labels = question.name.split('.');
            const answerBuffer = Buffer.alloc(question.name.length + 16 + labels.length);
            let aOffset = 0;
            labels.forEach(label => {
                answerBuffer.writeUInt8(label.length, aOffset);
                aOffset += 1;
                answerBuffer.write(label, aOffset);
                aOffset += label.length;
            });
            answerBuffer.writeUInt8(0, aOffset);
            aOffset += 1;
            answerBuffer.writeUInt16BE(1, aOffset); // Type A
            answerBuffer.writeUInt16BE(1, aOffset + 2); // Class IN
            answerBuffer.writeUInt32BE(60, aOffset + 4); // TTL
            answerBuffer.writeUInt16BE(4, aOffset + 8); // Data length
            answerBuffer.writeUInt32BE(0x08080808, aOffset + 10); // Address 8.8.8.8
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

udpSocket.bind(PORT, '127.0.0.1', () => {
    console.log(`[${new Date().toISOString()}] Socket bound to 127.0.0.1:${PORT}`);
});