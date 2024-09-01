import * as dgram from 'dgram';
import { argv } from 'process';

const PORT = 2053;
const udpSocket: dgram.Socket = dgram.createSocket('udp4');

// Add resolver configuration
const [, , , resolverArg] = argv;
const [resolverIp, resolverPort] = resolverArg.split(':');
const RESOLVER_PORT = parseInt(resolverPort, 10);

interface Question {
  name: string;
  qtype: number;
  qclass: number;
}

interface DNSRecord {
  name: string;
  type: number;
  cls: number;
  ttl: number;
  rdlength: number;
  rdata: Buffer;
}

class DNSMessage {
  packetId: number = 0;
  flags: number = 0;
  questions: Question[] = [];
  answers: DNSRecord[] = [];

  constructor(data?: Buffer) {
    if (data) {
      this.parse(data);
    }
  }

  parse(data: Buffer): void {
    let offset = 0;
    this.packetId = data.readUInt16BE(offset);
    offset += 2;
    this.flags = data.readUInt16BE(offset);
    offset += 2;
    const qdcount = data.readUInt16BE(offset);
    offset += 2;
    const ancount = data.readUInt16BE(offset);
    offset += 2;
    // Skip NSCOUNT and ARCOUNT
    offset += 4;

    for (let i = 0; i < qdcount; i++) {
      const [question, newOffset] = this.parseQuestion(data, offset);
      this.questions.push(question);
      offset = newOffset;
    }

    for (let i = 0; i < ancount; i++) {
      const [answer, newOffset] = this.parseAnswer(data, offset);
      this.answers.push(answer);
      offset = newOffset;
    }
  }

  private parseQuestion(data: Buffer, offset: number): [Question, number] {
    const [name, newOffset] = this.parseName(data, offset);
    offset = newOffset;
    const qtype = data.readUInt16BE(offset);
    offset += 2;
    const qclass = data.readUInt16BE(offset);
    offset += 2;
    return [{ name, qtype, qclass }, offset];
  }

  private parseAnswer(data: Buffer, offset: number): [DNSRecord, number] {
    const [name, newOffset] = this.parseName(data, offset);
    offset = newOffset;
    const type = data.readUInt16BE(offset);
    offset += 2;
    const cls = data.readUInt16BE(offset);
    offset += 2;
    const ttl = data.readUInt32BE(offset);
    offset += 4;
    const rdlength = data.readUInt16BE(offset);
    offset += 2;
    const rdata = data.slice(offset, offset + rdlength);
    offset += rdlength;
    return [{ name, type, cls, ttl, rdlength, rdata }, offset];
  }

  private parseName(data: Buffer, offset: number): [string, number] {
    const labels: string[] = [];
    let jumping = false;
    let jumpOffset = -1;

    while (true) {
      const length = data[offset];
      if (length === 0) {
        if (!jumping) offset++;
        break;
      }
      if ((length & 0xC0) === 0xC0) {
        if (!jumping) {
          jumpOffset = offset + 2;
        }
        offset = ((length & 0x3F) << 8) | data[offset + 1];
        jumping = true;
        continue;
      }
      offset++;
      labels.push(data.slice(offset, offset + length).toString('ascii'));
      offset += length;
      if (jumping && jumpOffset !== -1) {
        offset = jumpOffset;
        jumping = false;
        jumpOffset = -1;
      }
    }

    return [labels.join('.'), offset];
  }

  toBuffer(): Buffer {
    const headerBuffer = Buffer.alloc(12);
    headerBuffer.writeUInt16BE(this.packetId, 0);
    headerBuffer.writeUInt16BE(this.flags, 2);
    headerBuffer.writeUInt16BE(this.questions.length, 4);
    headerBuffer.writeUInt16BE(this.answers.length, 6);
    headerBuffer.writeUInt16BE(0, 8); // NSCOUNT
    headerBuffer.writeUInt16BE(0, 10); // ARCOUNT

    const questionBuffers = this.questions.map(q => this.questionToBuffer(q));
    const answerBuffers = this.answers.map(a => this.answerToBuffer(a));

    return Buffer.concat([headerBuffer, ...questionBuffers, ...answerBuffers]);
  }

  private questionToBuffer(question: Question): Buffer {
    const nameBuffer = this.nameToBuffer(question.name);
    const typeClassBuffer = Buffer.alloc(4);
    typeClassBuffer.writeUInt16BE(question.qtype, 0);
    typeClassBuffer.writeUInt16BE(question.qclass, 2);
    return Buffer.concat([nameBuffer, typeClassBuffer]);
  }

  private answerToBuffer(answer: DNSRecord): Buffer {
    const nameBuffer = this.nameToBuffer(answer.name);
    const fixedBuffer = Buffer.alloc(10);
    fixedBuffer.writeUInt16BE(answer.type, 0);
    fixedBuffer.writeUInt16BE(answer.cls, 2);
    fixedBuffer.writeUInt32BE(answer.ttl, 4);
    fixedBuffer.writeUInt16BE(answer.rdlength, 8);
    return Buffer.concat([nameBuffer, fixedBuffer, answer.rdata]);
  }

  private nameToBuffer(name: string): Buffer {
    const parts = name.split('.');
    const buffers = parts.map(part => {
      const buffer = Buffer.alloc(part.length + 1);
      buffer.writeUInt8(part.length, 0);
      buffer.write(part, 1);
      return buffer;
    });
    return Buffer.concat([...buffers, Buffer.from([0])]);
  }
}

// Add a function to forward DNS query
function forwardDNSQuery(query: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    client.send(query, RESOLVER_PORT, resolverIp, (err) => {
      if (err) {
        client.close();
        reject(err);
      }
    });

    client.on('message', (msg) => {
      client.close();
      resolve(msg);
    });

    client.on('error', (err) => {
      client.close();
      reject(err);
    });
  });
}

async function handleDNSQuery(query: DNSMessage): Promise<DNSMessage> {
  const response = new DNSMessage();
  response.packetId = query.packetId;
  response.flags = 0x8180; // Standard query response, no error
  response.questions = query.questions;

  for (const question of query.questions) {
    const singleQuestionQuery = new DNSMessage();
    singleQuestionQuery.packetId = query.packetId;
    singleQuestionQuery.flags = query.flags;
    singleQuestionQuery.questions = [question];

    const forwardedResponse = await forwardDNSQuery(singleQuestionQuery.toBuffer());
    const parsedResponse = new DNSMessage(forwardedResponse);

    response.answers.push(...parsedResponse.answers);
  }

  return response;
}

udpSocket.on('message', async (data: Buffer, remoteAddr: dgram.RemoteInfo) => {
  try {
    const query = new DNSMessage(data);
    const response = await handleDNSQuery(query);
    const responseBuffer = response.toBuffer();
    udpSocket.send(responseBuffer, remoteAddr.port, remoteAddr.address);
  } catch (e) {
    console.error(`Error processing or sending data: ${e}`);
    // Send an error response to the client
    const errorResponse = new DNSMessage();
    errorResponse.packetId = data.readUInt16BE(0);
    errorResponse.flags = 0x8182; // Response + Server Failure
    const errorBuffer = errorResponse.toBuffer();
    udpSocket.send(errorBuffer, remoteAddr.port, remoteAddr.address);
  }
});

udpSocket.bind(PORT, '127.0.0.1', () => {
    console.log(`[${new Date().toISOString()}] Socket bound to 127.0.0.1:${PORT}`);
});
