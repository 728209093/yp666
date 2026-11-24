import { randomInt } from 'node:crypto';
import sharp from 'sharp';

const width=320, height=180, pieceSize=44;
const maskPath='M0 0H14C14 8 30 8 30 0H44V44H0Z';

/** Every challenge has a fresh landscape; coordinates are never included in the image response. */
export async function renderSliderPuzzle(targetX:number,pieceY:number) {
  const palettes=[['#d5e4df','#f5e8cf','#8ca184','#496e5a'],['#cbdce7','#f6e5cd','#8ca6a0','#4e7271'],['#d8d7e7','#f4e4d7','#9c9baf','#646781']];
  const [skyTop,skyBottom,hillTop,hillBottom]=palettes[randomInt(palettes.length)]!;
  const mountain=(minimum:number,maximum:number)=>`M0 ${randomInt(minimum,maximum)} ${Array.from({length:7},(_,i)=>`L${Math.min(width,(i+1)*48)} ${randomInt(minimum,maximum)}`).join(' ')}V180H0Z`;
  const speckles=Array.from({length:200},()=>`<circle cx="${randomInt(width)}" cy="${randomInt(height)}" r="${randomInt(5,20)/10}" fill="${randomInt(2)?'#fff':'#29483b'}" opacity="${randomInt(8,25)/100}"/>`).join('');
  const landscape=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${skyTop}"/><stop offset="1" stop-color="${skyBottom}"/></linearGradient><linearGradient id="hill" x2="0" y2="1"><stop stop-color="${hillTop}"/><stop offset="1" stop-color="${hillBottom}"/></linearGradient></defs><rect width="320" height="180" fill="url(#sky)"/><circle cx="${randomInt(190,290)}" cy="${randomInt(25,55)}" r="${randomInt(16,27)}" fill="#f3d998" opacity=".85"/><path d="${mountain(42,117)}" fill="${hillTop}" opacity=".72"/><path d="${mountain(80,142)}" fill="url(#hill)"/><path d="M0 ${randomInt(141,164)}Q75 ${randomInt(123,148)} 140 ${randomInt(147,168)}T320 ${randomInt(139,160)}V180H0Z" fill="${hillBottom}"/>${speckles}</svg>`);
  const original=await sharp(landscape).png().toBuffer();
  const pieceMask=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${pieceSize}" height="${pieceSize}"><path d="${maskPath}" fill="#fff"/></svg>`);
  const hole=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path d="${maskPath}" transform="translate(${targetX} ${pieceY})" fill="#344a3f" fill-opacity=".48" stroke="#fbfcf7" stroke-opacity=".8" stroke-width="1.5" stroke-dasharray="4 3"/></svg>`);
  const [background,piece]=await Promise.all([
    sharp(original).composite([{input:hole}]).png().toBuffer(),
    sharp(original).extract({left:targetX,top:pieceY,width:pieceSize,height:pieceSize}).composite([{input:pieceMask,blend:'dest-in'}]).png().toBuffer(),
  ]);
  return {background,piece};
}
