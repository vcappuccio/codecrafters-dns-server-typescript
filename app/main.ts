import * as dgram from 'dgram';
import { argv } from 'process';

const PORT = 2053;
const udpSocket: dgram.Socket = dgram.createSocket('udp4');

// Add resolver configuration
const [, , , resolverArg] = argv;
const [resolverIp, resolverPort] = resolverArg.split(':');
const RESOLVER_PORT = parseInt(resolverPort, 10);

type Question = {
  domain: string;
  qType: number;
  qClass: number;
};

type DNSRecord = Question & {
  ttl: number;
  data: string;
};

type Label = {
  offset: number;
  content: string;
  next?: Label;
};

function followOffsets({
  labels,
  labelOffsetMap,
  offset,
}: {
  labels: Label[];
  labelOffsetMap: Record<number, Label>;
  offset: number;
}) {
  let currentLabel: Label | undefined = labelOffsetMap[offset];
  while (currentLabel) {
    labels.push(currentLabel);
    currentLabel = currentLabel.next;
  }
}

function parseQuestionSection(questionSection: Buffer, offset: number): Question[] {
  let i = offset;
  const questions: Question[] = [];
  
  while (i < questionSection.length) {
    const domain = parseDomainName(questionSection, i);
    i += domain.byteLength;
    
    if (i + 4 > questionSection.length) {
      break;
    }
    
    const qType = questionSection.readUInt16BE(i);
    i += 2;
    const qClass = questionSection.readUInt16BE(i);
    i += 2;
    
    questions.push({ domain: domain.name, qType, qClass });
  }
  
  return questions;
}

function parseDomainName(buffer: Buffer, offset: number): { name: string; byteLength: number } {
  const labels: string[] = [];
  let i = offset;
  let byteLength = 0;

  while (true) {
    const length = buffer[i];

    if (length === 0) {
      byteLength++;
      break;
    }

    if ((length & 0xc0) === 0xc0) {
      const pointerOffset = ((length & 0x3f) << 8) | buffer[i + 1];
      const pointerResult = parseDomainName(buffer, pointerOffset);
      labels.push(...pointerResult.name.split('.'));
      byteLength += 2;
      break;
    }

    i++;
    byteLength += length + 1;
    labels.push(buffer.slice(i, i + length).toString('ascii'));
    i += length;
  }

  return { name: labels.join('.'), byteLength };
}

function recordToQuestion(record: DNSRecord): Buffer {
  const domainParts = record.domain.split('.');
  const domainBuffer = Buffer.concat(
    domainParts.map(part => Buffer.concat([Buffer.from([part.length]), Buffer.from(part)]))
  );
  const endDomain = Buffer.from([0]);
  const typeAndClass = Buffer.alloc(4);
  typeAndClass.writeUInt16BE(record.qType, 0);
  typeAndClass.writeUInt16BE(record.qClass, 2);
  
  return Buffer.concat([domainBuffer, endDomain, typeAndClass]);
}

function recordToAnswer(record: DNSRecord): Buffer {
  const question = recordToQuestion(record);
  const ttlAndLength = Buffer.alloc(6);
  ttlAndLength.writeUInt32BE(record.ttl, 0);
  const ipParts = record.data.split('.').map(Number);
  const ipBuffer = Buffer.from(ipParts);
  ttlAndLength.writeUInt16BE(ipBuffer.length, 4);
  
  return Buffer.concat([question, ttlAndLength, ipBuffer]);
}

class DNSMessage {
  private packetId: number;
  private queryResponse: boolean;
  private opCode: number;
  private authoritativeAnswer: boolean = false;
  private truncation: boolean = false;
  private recursionDesired: boolean;
  private recursionAvailable: boolean = false;
  private responseCode: number = 0;
  private questions: Question[] = [];
  private answers: DNSRecord[] = [];

  constructor(data?: Buffer) {
    if (data) {
      this.packetId = data.readUInt16BE(0);
      const flags = data.readUInt16BE(2);
      this.queryResponse = Boolean(flags & 0x8000);
      this.opCode = (flags >> 11) & 0xF;
      this.authoritativeAnswer = Boolean(flags & 0x0400);
      this.truncation = Boolean(flags & 0x0200);
      this.recursionDesired = Boolean(flags & 0x0100);
      this.recursionAvailable = Boolean(flags & 0x0080);
      this.responseCode = flags & 0x000F;
      
      const questionCount = data.readUInt16BE(4);
      const answerCount = data.readUInt16BE(6);
      
      let offset = 12;
      for (let i = 0; i < questionCount; i++) {
        const [question, newOffset] = this.parseQuestion(data, offset);
        this.questions.push(question);
        offset = newOffset;
      }
      
      for (let i = 0; i < answerCount; i++) {
        const [answer, newOffset] = this.parseAnswer(data, offset);
        this.answers.push(answer);
        offset = newOffset;
      }
    } else {
      this.packetId = 0;
      this.queryResponse = false;
      this.opCode = 0;
      this.recursionDesired = false;
    }
  }

  private parseQuestion(data: Buffer, offset: number): [Question, number] {
    const { name, byteLength } = parseDomainName(data, offset);
    offset += byteLength;
    const qType = data.readUInt16BE(offset);
    offset += 2;
    const qClass = data.readUInt16BE(offset);
    offset += 2;
    return [{ domain: name, qType, qClass }, offset];
  }

  private parseAnswer(data: Buffer, offset: number): [DNSRecord, number] {
    const { name, byteLength } = parseDomainName(data, offset);
    offset += byteLength;
    const qType = data.readUInt16BE(offset);
    offset += 2;
    const qClass = data.readUInt16BE(offset);
    offset += 2;
    const ttl = data.readUInt32BE(offset);
    offset += 4;
    const dataLength = data.readUInt16BE(offset);
    offset += 2;
    const recordData = data.slice(offset, offset + dataLength).toString('utf-8');
    offset += dataLength;
    return [{ domain: name, qType, qClass, ttl, data: recordData }, offset];
  }

  toBuffer(): Buffer {
    const header = this.getHeader();
    const questions = this.getQuestionSection();
    const answers = this.getAnswerSection();

    return Buffer.concat([header, questions, answers]);
  }

  private getHeader(): Buffer {
    const header = Buffer.alloc(12);
    header.writeUInt16BE(this.packetId, 0);
    
    let flags = 0;
    flags |= this.queryResponse ? 0x8000 : 0;
    flags |= (this.opCode << 11) & 0x7800;
    flags |= this.authoritativeAnswer ? 0x0400 : 0;
    flags |= this.truncation ? 0x0200 : 0;
    flags |= this.recursionDesired ? 0x0100 : 0;
    flags |= this.recursionAvailable ? 0x0080 : 0;
    flags |= this.responseCode & 0x000F;
    
    header.writeUInt16BE(flags, 2);
    header.writeUInt16BE(this.questions.length, 4); // QDCOUNT
    header.writeUInt16BE(this.answers.length, 6); // ANCOUNT
    header.writeUInt16BE(0, 8); // NSCOUNT
    header.writeUInt16BE(0, 10); // ARCOUNT

    return header;
  }

  private getQuestionSection(): Buffer {
    return Buffer.concat(this.questions.map(recordToQuestion));
  }

  private getAnswerSection(): Buffer {
    return Buffer.concat(this.answers.map(recordToAnswer));
  }

  setAnswers(answers: DNSRecord[]) {
    this.answers = answers;
    this.queryResponse = true;
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

class DNS {
  parseQuestion(data: Buffer, startOffset: number): [string, number] {
    let labels: string[] = [];
    let offset = startOffset;
    let jumping = false;
    let jumpOffset = -1;

    while (offset < data.length) {
      const length = data[offset];
      if (length === 0) {
        if (!jumping) offset++;
        break;
      }
      if ((length & 0xC0) === 0xC0) {
        if (!jumping) {
          jumpOffset = offset + 2;
        }
        jumping = true;
        offset = ((length & 0x3F) << 8) | data[offset + 1];
        continue;
      }
      if (offset + length + 1 > data.length) break;
      labels.push(data.subarray(offset + 1, offset + 1 + length).toString("ascii"));
      offset += length + 1;
      if (jumping && jumpOffset !== -1) {
        offset = jumpOffset;
        jumping = false;
        jumpOffset = -1;
      }
    }

    return [labels.join('.'), offset];
  }
}

udpSocket.on('message', async (data: Buffer, remoteAddr: dgram.RemoteInfo) => {
  try {
    const query = new DNSMessage(data);
    const forwardedResponse = await forwardDNSQuery(data);
    const response = new DNSMessage(forwardedResponse);
    response.packetId = query.packetId;
    const responseBuffer = response.toBuffer();
    udpSocket.send(responseBuffer, remoteAddr.port, remoteAddr.address);
  } catch (e) {
    console.error(`Error processing or sending data: ${e}`);
  }
});

udpSocket.bind(PORT, '127.0.0.1', () => {
    console.log(`[${new Date().toISOString()}] Socket bound to 127.0.0.1:${PORT}`);
});
