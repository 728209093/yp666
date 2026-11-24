import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { decodeUpload, maximumUploadBytes } from '../src/media.js';

test('image upload is actually decoded and re-encoded without source metadata',async()=>{
  const png=await sharp({create:{width:24,height:16,channels:3,background:'#dc2345'}}).png().toBuffer();
  const decoded=await decodeUpload(png,'example.png');
  assert.equal(decoded.type,'image');
  assert.equal(decoded.extension,'webp');
  const metadata=await sharp(decoded.data).metadata();
  assert.equal(metadata.format,'webp');
  assert.equal(metadata.width,24);
  assert.equal(metadata.height,16);
});

test('SVG, HTML, fake videos and oversized uploads are rejected',async()=>{
  for(const [content,name] of [['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>','fake.png'],['<html>unsafe</html>','fake.mp4'],['not a real video','video.webm']]) {
    await assert.rejects(()=>decodeUpload(Buffer.from(content),name));
  }
  await assert.rejects(()=>decodeUpload(Buffer.alloc(maximumUploadBytes+1),'big.mp4'));
  const fakeMp4=Buffer.from('000000186674797069736f6d0000020069736f6d69736f32','hex');
  await assert.rejects(()=>decodeUpload(fakeMp4,'clip.mp4'));
});

test('browser-recorded WebM without a duration header is accepted after frame decoding', {skip: !process.env.FFPROBE_PATH}, async()=>{
  const fixture=Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAH/EU2bdLlNu4tTq4QVSalmU6yBbk27i1OrhBZUrmtTrIGTTbuLU6uEH0O2dVOsgcFNu4xTq4QcU7trU6yCAe3srgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmoCrXsYMPQkBEiYRDHUJOTYCGQ2hyb21lV0GGQ2hyb21lFlSua6mup9eBAXPFh8XgCIYStPKDgQFV7oEBhoVWX1ZQOOCKsIGguoF4U8CBAR9DtnUBAAAAAAABIOeBAKBAsqHlgQAAAHAHAJ0BKqAAeAAABwiFhYiZhIgBJBAOwD+AP6AgbrzCM09xp2s09xqJV5prOnTp06dOnTp06dOnTp06dOnTp06dOnTp06dOnRwAP7zpP///HMm5hif8c2///t6T9BIm3/t2v/3piB1ocimxu6BAaXBUAYAnQEqoAB4AADHCIWFiJmEiAQCAAYiDwUQnFLSoTilpUJxS0qE4paVCcUtKhOKWlQnFLSoTilpUJsA/v9v2ACg5qHDgQCdAFEEAAAQCSAAwADJf6BgAD4BwFQHAVsYCtYwFaxgK1jAVrGArQD+/CnR/67xtmG27b//+xk1BwDL/sUyomjwAHWhm6aZ7oEBpZQRAgADECgAGAAYWC/0AAiAgQywAPuBABxTu2uNu4uzgQC3hveBAfGBwQ==','base64');
  const result=await decodeUpload(fixture,'recording.webm');
  assert.equal(result.type,'video');
  assert.equal(result.extension,'webm');
});
