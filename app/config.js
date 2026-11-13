// KYRON · configuration du serveur de comptes (Supabase).
// Vider url et anonKey ('') = mode local : les comptes et les séances restent sur cet appareil (navigateur).
// Pour activer les vrais comptes en ligne, suivre docs/SUPABASE.md puis coller ici :
//   url     : « Project URL »  (ex. 'https://abcdefghijkl.supabase.co')
//   anonKey : clé « anon public » (elle peut être publiée : la sécurité vient des règles RLS du script SQL)
// Les comptes en ligne ne marchent que sur un vrai site web (GitHub Pages, localhost) :
// dans la page claude.ai, les appels vers d'autres domaines sont bloqués, donc on reste en local.
const HOST = (typeof location !== 'undefined' && location.hostname) || '';
const CLOUD_OK = !HOST || /(^|\.)github\.io$|^localhost$|^127\.0\.0\.1$/.test(HOST);
export const SUPABASE = {
  url: CLOUD_OK ? 'https://dhomehxseunhckifdbiv.supabase.co' : '',
  anonKey: CLOUD_OK ? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRob21laHhzZXVuaGNraWZkYml2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1ODM1ODMsImV4cCI6MjExMDE1OTU4M30.Zwgg3ia2ak1IxT7DHnw7tr6jU7GHqBhb9cKbujownSQ' : '',
};
