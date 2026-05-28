/**
 * STT 模块 — 语音转文字（Speech-to-Text）
 * 通过 voicechat_player_sound 事件接收附近玩家语音，
 * 积累 PCM 音频片段 → WAV → MiMo 音频理解 API → 文字
 */
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');

// WAV 文件头写入
function createWav(pcmBuffer, sampleRate = 48000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = pcmBuffer.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

class STTModule {
  constructor(bot, deps = {}) {
    this.bot = bot;
    this.config = deps.config || {};
    this.voiceConfig = this.config.voice || {};

    this._enabled = this.voiceConfig.stt?.enabled !== false;

    /** MiMo 客户端（音频理解） */
    if (this._enabled && this.voiceConfig.apiKey) {
      this._stt = new OpenAI({
        apiKey: this.voiceConfig.apiKey,
        baseURL: this.voiceConfig.baseUrl || 'https://api.xiaomimimo.com/v1',
      });
    }

    /** 音频缓冲 { playerName: Buffer[] } */
    this._buffers = {};

    /** 静音超时定时器 { playerName: timeoutId } */
    this._timers = {};

    /** 字节上限 — 约 30 秒 48kHz mono s16le */
    this._maxBytes = 48000 * 2 * 30;
    this._silenceMs = this.voiceConfig.stt?.silenceMs ?? 1200;
    this._minBytes = this.voiceConfig.stt?.minBytes ?? 19200; // ~200ms
    this._lastTranscription = 0;
    this._cooldownMs = 3000; // 两次转写至少间隔 3 秒

    /** 转录回调 (text, playerName) => void */
    this._onTranscription = null;

    /** 临时目录 */
    this._tmpDir = path.join(os.tmpdir(), 'mc-ai-buddy-stt');
  }

  // ===== 初始化 =====

  init() {
    if (!this._enabled) return;

    try { fs.mkdirSync(this._tmpDir, { recursive: true }); } catch {}

    this.bot.on('voicechat_player_sound', (data) => {
      this._handleChunk(data);
    });
  }

  /** 注册转录结果回调 */
  onTranscription(cb) {
    this._onTranscription = cb;
  }

  setEnabled(on) {
    this._enabled = on;
    if (!on) {
      this._buffers = {};
      for (const name of Object.keys(this._timers)) {
        clearTimeout(this._timers[name]);
      }
      this._timers = {};
    }
  }

  // ===== 内部 =====

  _handleChunk(data) {
    if (!this._enabled || !this._stt) return;

    const { sender, data: pcm } = data;
    if (!sender || !pcm || pcm.length === 0) return;

    // 忽略 bot 自己的声音，防止 TTS → STT 反馈回路
    if (sender === this.bot.username) return;

    // 初始化缓冲区
    if (!this._buffers[sender]) {
      this._buffers[sender] = [];
    }

    // 防止溢出：丢弃最旧的数据
    let total = this._buffers[sender].reduce((s, b) => s + b.length, 0);
    if (total + pcm.length > this._maxBytes) {
      this._buffers[sender] = [pcm];
      total = pcm.length;
    } else {
      this._buffers[sender].push(pcm);
      total += pcm.length;
    }

    // 重置静音计时器
    if (this._timers[sender]) {
      clearTimeout(this._timers[sender]);
    }

    this._timers[sender] = setTimeout(() => {
      this._processUtterance(sender);
    }, this._silenceMs);
  }

  async _processUtterance(playerName) {
    const chunks = this._buffers[playerName];
    if (!chunks || chunks.length === 0) return;

    // 清理
    delete this._buffers[playerName];
    delete this._timers[playerName];

    // 冷却检查：防止短时间内重复转写
    if (Date.now() - this._lastTranscription < this._cooldownMs) return;
    this._lastTranscription = Date.now();

    const pcm = Buffer.concat(chunks);
    if (pcm.length < this._minBytes) return; // 太短，跳过

    const wavFile = path.join(this._tmpDir, `stt_${Date.now()}_${playerName.replace(/[^a-zA-Z0-9_一-龥]/g, '_')}.wav`);
    const wav = createWav(pcm);

    try {
      const text = await this._transcribe(wav);
      if (text && this._onTranscription) {
        console.log(`[STT] 🎤 ${playerName}: "${text}"`);
        this._onTranscription(text, playerName);
      }
    } catch (err) {
      console.log(`[STT] 转录失败 (${playerName}): ${err.message}`);
    } finally {
      try { fs.unlinkSync(wavFile); } catch {}
    }
  }

  async _transcribe(wavBuffer) {
    const base64 = wavBuffer.toString('base64');

    const response = await this._stt.chat.completions.create({
      model: 'mimo-v2.5',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: {
                data: `data:audio/wav;base64,${base64}`,
              },
            },
            {
              type: 'text',
              text: '请直接输出这段音频的文字内容，只输出纯文字，不要任何其他内容。',
            },
          ],
        },
      ],
      max_completion_tokens: 256,
    });

    const msg = response.choices[0]?.message;
    // content 为空时取 reasoning_content
    return (msg?.content || msg?.reasoning_content || '').trim();
  }
}

module.exports = { STTModule };
