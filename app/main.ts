import * as dgram from "dgram";

const PORT = 2053 ;
const udpSocket: dgram.Socket = dgram.createSocket("udp4");
console.log(`[${new Date().toISOString()}] Socket created`);

udpSocket.bind(PORT, "127.0.0.1", () => {
    console.log(`[${new Date().toISOString()}] Socket bound to 127.0.0.1:${PORT}`);
});

udpSocket.on("listening", () => {
    const address = udpSocket.address();
    console.log(`[${new Date().toISOString()}] Server listening on ${address.address}:${address.port}`);
});

/**
 * Interface representing the structure of a DNS header.
 */
interface DNSHeader {
    id: number;
    qr: number;
    opcode: number;
    aa: number;
    tc: number;
    rd: number;
    ra: number;
    z: number;
    rcode: number;
    qdcount: number;
    ancount: number;
    nscount: number;
    arcount: number;
}

/**
 * Creates a DNS header buffer.
 * @returns {Buffer} The DNS header as a buffer.
 */
function createDNSHeader(): Buffer {
    const header: DNSHeader = {
        id: 1234,
        qr: 1,
        opcode: 0,
        aa: 0,
        tc: 0,
        rd: 0,
        ra: 0,
        z: 0,
        rcode: 0,
        qdcount: 0,
        ancount: 0,
        nscount: 0,
        arcount: 0,
    };

    const buffer = Buffer.alloc(12);
    buffer.writeUInt16BE(header.id, 0);
    buffer.writeUInt16BE(
        (header.qr << 15) |
        (header.opcode << 11) |
        (header.aa << 10) |
        (header.tc << 9) |
        (header.rd << 8) |
        (header.ra << 7) |
        (header.z << 4) |
        header.rcode,
        2
    );
    buffer.writeUInt16BE(header.qdcount, 4);
    buffer.writeUInt16BE(header.ancount, 6);
    buffer.writeUInt16BE(header.nscount, 8);
    buffer.writeUInt16BE(header.arcount, 10);

    return buffer;
}

function createDNSQuestion(): Buffer {
    const name = Buffer.from("0c636f6465637261667465727302696f00", "hex"); // codecrafters.io
    const type = Buffer.alloc(2);
    type.writeUInt16BE(1, 0); // Type A
    const cls = Buffer.alloc(2);
    cls.writeUInt16BE(1, 0); // Class IN

    return Buffer.concat([name, type, cls]);
}

function createDNSResponse(): Buffer {
    const header = createDNSHeader();
    const question = createDNSQuestion();
    return Buffer.concat([header, question]);
}

udpSocket.on("message", (data: Buffer, remoteAddr: dgram.RemoteInfo) => {
    try {
        console.log(`[${new Date().toISOString()}] Received data from ${remoteAddr.address}:${remoteAddr.port}`);
        console.log(`[${new Date().toISOString()}] Data: ${data.toString('hex')}`);
        const response = createDNSResponse();
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