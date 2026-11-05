import {protectText, translationInstructions} from './codex-translator.mjs';

export class ChatCompletionsTranslator {
  controller = new AbortController();

  async translate(text, targetLanguage, {apiBaseUrl, apiModel, apiKey}, signal) {
    const protectedText = protectText(text);
    const timeout = AbortSignal.timeout(120000);
    const signals = [this.controller.signal, timeout];
    if (signal) signals.push(signal);
    const response = await fetch(apiBaseUrl + '/chat/completions', {
      method: 'POST',
      redirect: 'error',
      headers: {'Content-Type':'application/json', Authorization:'Bearer ' + apiKey},
      signal: AbortSignal.any(signals),
      body: JSON.stringify({
        model: apiModel,
        messages: [
          {role:'system', content: translationInstructions + ' Return only the translated text.'},
          {role:'user', content: JSON.stringify({targetLanguage, text:protectedText.text})},
        ],
      }),
    });
    if (!response.ok) throw Error('TRANSLATION_API_HTTP_' + response.status);
    const result = await response.json();
    const choice = result.choices?.[0];
    if (choice?.finish_reason && choice.finish_reason !== 'stop') throw Error('TRANSLATION_INCOMPLETE');
    return protectedText.restore(choice?.message?.content);
  }

  async status(prefs) {
    await this.translate('Hello', prefs.outputLanguage || 'zh-CN', prefs);
    return {authenticated:true, provider:prefs.provider, model:prefs.apiModel};
  }

  close() { this.controller.abort(); }
}
