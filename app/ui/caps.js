// KYRON · capacités de claude.ai (coach IA, téléchargements, lecture à voix haute) : absentes hors de claude.ai, jamais bloquantes
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
function use(name) {
  try {
    const c = window.claude;
    if (!c || typeof c.use !== 'function') return Promise.resolve(null);
    return withTimeout(Promise.resolve(c.use(name)).catch(() => null), 12000);
  } catch (e) { return Promise.resolve(null); }
}
export const sampleP = use('sample');
export const downloadsP = use('downloads');
export const ttsP = use('tts');
