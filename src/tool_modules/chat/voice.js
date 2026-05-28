/**
 * Voice 模块 — MiMo TTS + Simple Voice Chat 集成
 * 使用 Xiaomi MiMo-V2.5-TTS API 合成语音，通过 mineflayer-simplevoice 在游戏中播放
 */
const OpenAI = require('openai');
const simplevoice = require('mineflayer-simplevoice');
const fs = require('fs');
const path = require('path');
const os = require('os');

class VoiceModule {
  constructor(bot, deps = {}) {
    this.bot = bot;
    this.config = deps.config || {};
    this.voiceConfig = this.config.voice || {};

    this._enabled = this.voiceConfig.enabled !== false;
    this._ready = false;

    /** MiMo TTS 客户端 */
    if (this._enabled && this.voiceConfig.apiKey) {
      this._tts = new OpenAI({
        apiKey: this.voiceConfig.apiKey,
        baseURL: this.voiceConfig.baseUrl || 'https://api.xiaomimimo.com/v1',
      });
    }

    this._model = this.voiceConfig.model || 'mimo-v2.5-tts';
    this._voice = this.voiceConfig.voice || '冰糖';
    this._voicePrompt = this.voiceConfig.prompt ||
      '用轻松自然的语气，像一个在游戏里一起玩的朋友一样说话。语速适中，带一点活泼感。';

    /** 播放队列 */
    this._queue = [];
    this._playing = false;

    this._minLength = this.voiceConfig.minLength ?? 4;
    this._tmpDir = path.join(os.tmpdir(), 'mc-ai-buddy-voice');
  }

  // ===== 初始化 =====

  init() {
    if (!this._enabled) return;

    try { fs.mkdirSync(this._tmpDir, { recursive: true }); } catch {}

    this.bot.loadPlugin(simplevoice.plugin);

    this.bot.on('voicechat_connect', () => {
      this._ready = true;
      console.log('[Voice] 🎙️ Simple Voice Chat 已连接');
      this._drainQueue();
    });

    this.bot.on('voicechat_disconnect', () => {
      this._ready = false;
      console.log('[Voice] 🔇 语音已断开');
    });

    this.bot.on('voicechat_error', (err) => {
      console.log('[Voice] ⚠️ ' + (err.message || err));
    });

    // simplevoice.setLoggingLevel(0); // 取消注释以开启调试日志
  }

  // ===== 公开 API =====

  async speak(text) {
    if (!this._enabled || !text || !this._tts) return;

    const clean = text.substring(0, 256).trim();
    if (clean.length < this._minLength) return;

    this._queue.push(clean);
    if (!this._playing) {
      this._drainQueue();
    }
  }

  isReady() {
    return this._ready;
  }

  setEnabled(on) {
    this._enabled = on;
    if (!on) this._queue = [];
  }

  // ===== 内部 =====

  async _drainQueue() {
    if (this._playing || this._queue.length === 0) return;
    if (!this._ready) return;

    this._playing = true;

    while (this._queue.length > 0) {
      const text = this._queue.shift();
      try {
        await this._speakOne(text);
      } catch (err) {
        console.log('[Voice] TTS 失败: ' + err.message);
      }
      if (this._queue.length > 0) {
        await this._sleep(300);
      }
    }

    this._playing = false;
  }

  async _speakOne(text) {
    const filepath = path.join(this._tmpDir, `tts_${Date.now()}.wav`);

    const response = await this._tts.chat.completions.create({
      model: this._model,
      messages: [
        { role: 'user', content: this._voicePrompt },
        { role: 'assistant', content: text },
      ],
      audio: {
        format: 'wav',
        voice: this._voice,
      },
    });

    const audioData = response.choices[0]?.message?.audio?.data;
    if (!audioData) {
      throw new Error('MiMo 返回无音频数据');
    }

    fs.writeFileSync(filepath, Buffer.from(audioData, 'base64'));
    this.bot.voicechat.sendAudio(filepath);
    console.log('[Voice] 🔊 ' + text.substring(0, 40));
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { VoiceModule };
