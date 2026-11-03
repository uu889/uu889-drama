import assert from 'node:assert/strict'
import { test } from 'node:test'
import { videoChainDepth, videoPathsForEndFrame, toStaticRel } from '../src/services/chain-depth'
import { MiniMaxVideoAdapter, resetMiniMaxRatioModes } from '../src/services/adapters/minimax-video'

function lookupFrom(tasks: Record<string, { provider?: string; params: any }>) {
  return async (v: string) => (tasks[v] ? { provider: tasks[v].provider, params: JSON.stringify(tasks[v].params) } : null)
}

test('chain depth: end-frame paths map back to their videos', () => {
  assert.deepEqual(videoPathsForEndFrame('static/videos/a_sub_last.jpg')[0], 'static/videos/a_sub.mp4')
  assert.equal(toStaticRel('http://127.0.0.1:5679/static/videos/a_last.jpg?x=1'), 'static/videos/a_last.jpg')
  assert.deepEqual(videoPathsForEndFrame('static/images/a.jpg'), [])
})

test('chain depth counts consecutive first-frame hops and stops at a fresh shot', async () => {
  const lookup = lookupFrom({
    'static/videos/s1.mp4': { params: { referenceImageUrls: ['static/images/char.png'] } },
    'static/videos/s2.mp4': { params: { firstFrameUrl: 'static/videos/s1_last.jpg' } },
    'static/videos/s3_sub.mp4': { params: { firstFrameUrl: '/static/videos/s2_last.jpg' } },
    'static/videos/s3_sub_1080p.mp4': { provider: 'upscale', params: { upscale: { source: 'static/videos/s3_sub.mp4' } } },
    // 参考图模式接戏不算一代（不继承像素）
    'static/videos/s4.mp4': { params: { referenceImageUrls: ['static/videos/s3_sub_last.jpg'] } },
  })
  assert.equal(await videoChainDepth('static/videos/s1.mp4', lookup), 0)
  assert.equal(await videoChainDepth('static/videos/s2.mp4', lookup), 1)
  assert.equal(await videoChainDepth('static/videos/s3_sub.mp4', lookup), 2)
  assert.equal(await videoChainDepth('static/videos/s3_sub_1080p.mp4', lookup), 2)
  assert.equal(await videoChainDepth('static/videos/s4.mp4', lookup), 0)
  assert.equal(await videoChainDepth('static/videos/unknown.mp4', lookup), 0)
})

const cfg: any = { provider: 'minimax', baseUrl: 'https://relay.example.com', apiKey: 'k', model: 'MiniMax-H3' }

test('minimax: ratio is always sent, including image-to-video with a first frame', () => {
  resetMiniMaxRatioModes()
  const a = new MiniMaxVideoAdapter()
  const t2v = a.buildGenerateRequest(cfg, { id: 1, prompt: 'x', aspectRatio: '9:16' } as any)
  assert.equal(t2v.body.ratio, '9:16')
  const i2v = a.buildGenerateRequest(cfg, { id: 2, prompt: 'x', aspectRatio: '16:9', firstFrameUrl: 'https://x/a.jpg' } as any)
  assert.equal(i2v.body.ratio, '16:9')
  const bad = a.buildGenerateRequest(cfg, { id: 3, prompt: 'x', aspectRatio: 'weird' } as any)
  assert.equal(bad.body.ratio, '16:9')
})

test('minimax: a ratio rejection on a first-frame request falls back to adaptive, then to no ratio', async () => {
  resetMiniMaxRatioModes()
  const a = new MiniMaxVideoAdapter()
  const rec: any = { id: 4, prompt: 'x', aspectRatio: '16:9', firstFrameUrl: 'https://x/a.jpg' }
  assert.equal(await a.fallbackRequest(cfg, { ...rec, firstFrameUrl: '' }, 400, 'ratio must be adaptive'), null)
  assert.equal(await a.fallbackRequest(cfg, rec, 400, 'prompt too long'), null)
  const fb1 = await a.fallbackRequest(cfg, rec, 400, '{"error":"ratio must be adaptive"}')
  assert.equal(fb1!.request.body.ratio, 'adaptive')
  const fb2 = await a.fallbackRequest(cfg, rec, 400, 'invalid ratio')
  assert.equal('ratio' in fb2!.request.body, false)
  // 记住了：下一次直接按不带 ratio 提交；文生视频不受影响
  assert.equal('ratio' in a.buildGenerateRequest(cfg, rec).body, false)
  assert.equal(a.buildGenerateRequest(cfg, { ...rec, firstFrameUrl: '' }).body.ratio, '16:9')
})
