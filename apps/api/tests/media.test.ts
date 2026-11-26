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
  // Chromium-recorded VP8; replace Duration with an equal-length EBML Void to model a live stream.
  const fixture=Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAMaEU2bdLlNu4tTq4QVSalmU6yBbk27i1OrhBZUrmtTrIGTTbuLU6uEH0O2dVOsgdRNu4xTq4QcU7trU6yCAwjsrgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmoCrXsYMPQkDshQAAAAAATYCGQ2hyb21lV0GGQ2hyb21lFlSua7yuuteBAXPFh6gB/KfN5fSDgQFV7oEBhoVWX1ZQOOCdsIGguoF4U8CBAVWwkFWxgQFVuYECVbqBDVW7gQEfQ7Z1AQAAAAAAAijngQCgQLWh6YEAAACQCACdASqgAHgACQcIhYWImYSIMIIDQXK7F5roLfz5LX4vP1rqDX2IjVpJMbdQd8DA60r0Xpb73tqN1ikEt951YfnyXTz3yj/PnJL8+ID+y110l0uPjdN+tula7BMVXKc7nhzxwHWhx6bF7oEBpcBQBgCdASqgAHgACocIhYWImYSIOAIABiIPBRCcUtKhOKWlQnFLSoTilpUJxS0qE4paVCcUtKhOKWlQmwD+664AoPKhz4EAewDxBAAkEUgAGAgxkr0VVtwBTZx68448S2EA40BILr0HgPb3/Zz+Ej67h3D+15Q9nwZ1Q3WxFziFk8DEu0A68RR5xsaqsWTBkkDaPgB1oZumme6BAaWUEQIAKhHAABgAGFgv9AAIgIEMsAD7gQCgQI6h64EA+ADxBQAkERgAGBBgP6AgNydv6AAbvWNVXrGrw6lUsHScmKu+uu/bfh9Xw4DXNGtSCon0AP7cULKfr1I1eod+duHPC4a/5m3+Vvo/6FEuQAekV00EkTDYJt4teUPoP+Bql5P0ojueAWwAdaGbppnugQGllBECACoRwAAYABhYL/QACICBDLAA+4F7oOahw4EBcwCRBAAkEPQAGAAa58f0AAdCDkHIOQcg5Bx1w4S+XN3jU7LE8xKvegD+339n3+cNPbEorXm7OQAUPM1EKdJdCyB1oZumme6BAaWUEQIAKhG0ABgAGFgv9AAIgIEMsAD7gfgcU7trjbuLs4EAt4b3gQHxgdQ=','base64');
  const result=await decodeUpload(fixture,'recording.webm');
  assert.equal(result.type,'video');
  assert.equal(result.extension,'webm');
});
