import test from 'node:test';import assert from 'node:assert/strict';
import {VIDEO_MAX_BYTES,encodingPlan,encodingArgs,compressVideo} from '../src/video-compression.js';
test('small videos remain unchanged and large-video rates budget for audio and container overhead',async()=>{
 const file={size:VIDEO_MAX_BYTES};assert.equal(await compressVideo(file),file);
 for(const seconds of [30,120,600,1800]){const p=encodingPlan(seconds);assert.ok((p.video+p.audio)*seconds/8<VIDEO_MAX_BYTES);assert.ok(encodingPlan(seconds,1).video<=p.video)}
 assert.throws(()=>encodingPlan(NaN));assert.throws(()=>encodingPlan(0));
 const args=encodingArgs(120);assert.ok(args.includes('0:a:0?'));assert.ok(!args.includes('-t'));assert.ok(!args.includes('-fs'));
});
