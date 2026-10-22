// «Моя еда» — ИИ-помощник: прокси к GigaChat (Сбер) из Supabase Edge Function.
// • Ключ GigaChat — только в секрете GIGACHAT_AUTH_KEY, в приложение не попадает.
// • Отвечает только вошедшим пользователям, чья почта есть в секрете ASSISTANT_ALLOWED_EMAILS
//   (через запятую) — чтобы посторонние не расходовали бесплатные токены.
// • Функция сама ничего не меняет в данных: она передаёт GigaChat сообщения и описания функций
//   приложения и возвращает ответ модели. Действия выполняет приложение (и спрашивает подтверждение).

// Корневой сертификат Минцифры «Russian Trusted Root CA» (до 27.02.2032), SHA-256 D2:6D:2D:02…CF:31.
const RUSSIAN_TRUSTED_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIFwjCCA6qgAwIBAgICEAAwDQYJKoZIhvcNAQELBQAwcDELMAkGA1UEBhMCUlUx
PzA9BgNVBAoMNlRoZSBNaW5pc3RyeSBvZiBEaWdpdGFsIERldmVsb3BtZW50IGFu
ZCBDb21tdW5pY2F0aW9uczEgMB4GA1UEAwwXUnVzc2lhbiBUcnVzdGVkIFJvb3Qg
Q0EwHhcNMjIwMzAxMjEwNDE1WhcNMzIwMjI3MjEwNDE1WjBwMQswCQYDVQQGEwJS
VTE/MD0GA1UECgw2VGhlIE1pbmlzdHJ5IG9mIERpZ2l0YWwgRGV2ZWxvcG1lbnQg
YW5kIENvbW11bmljYXRpb25zMSAwHgYDVQQDDBdSdXNzaWFuIFRydXN0ZWQgUm9v
dCBDQTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAMfFOZ8pUAL3+r2n
qqE0Zp52selXsKGFYoG0GM5bwz1bSFtCt+AZQMhkWQheI3poZAToYJu69pHLKS6Q
XBiwBC1cvzYmUYKMYZC7jE5YhEU2bSL0mX7NaMxMDmH2/NwuOVRj8OImVa5s1F4U
zn4Kv3PFlDBjjSjXKVY9kmjUBsXQrIHeaqmUIsPIlNWUnimXS0I0abExqkbdrXbX
YwCOXhOO2pDUx3ckmJlCMUGacUTnylyQW2VsJIyIGA8V0xzdaeUXg0VZ6ZmNUr5Y
Ber/EAOLPb8NYpsAhJe2mXjMB/J9HNsoFMBFJ0lLOT/+dQvjbdRZoOT8eqJpWnVD
U+QL/qEZnz57N88OWM3rabJkRNdU/Z7x5SFIM9FrqtN8xewsiBWBI0K6XFuOBOTD
4V08o4TzJ8+Ccq5XlCUW2L48pZNCYuBDfBh7FxkB7qDgGDiaftEkZZfApRg2E+M9
G8wkNKTPLDc4wH0FDTijhgxR3Y4PiS1HL2Zhw7bD3CbslmEGgfnnZojNkJtcLeBH
BLa52/dSwNU4WWLubaYSiAmA9IUMX1/RpfpxOxd4Ykmhz97oFbUaDJFipIggx5sX
ePAlkTdWnv+RWBxlJwMQ25oEHmRguNYf4Zr/Rxr9cS93Y+mdXIZaBEE0KS2iLRqa
OiWBki9IMQU4phqPOBAaG7A+eP8PAgMBAAGjZjBkMB0GA1UdDgQWBBTh0YHlzlpf
BKrS6badZrHF+qwshzAfBgNVHSMEGDAWgBTh0YHlzlpfBKrS6badZrHF+qwshzAS
BgNVHRMBAf8ECDAGAQH/AgEEMA4GA1UdDwEB/wQEAwIBhjANBgkqhkiG9w0BAQsF
AAOCAgEAALIY1wkilt/urfEVM5vKzr6utOeDWCUczmWX/RX4ljpRdgF+5fAIS4vH
tmXkqpSCOVeWUrJV9QvZn6L227ZwuE15cWi8DCDal3Ue90WgAJJZMfTshN4OI8cq
W9E4EG9wglbEtMnObHlms8F3CHmrw3k6KmUkWGoa+/ENmcVl68u/cMRl1JbW2bM+
/3A+SAg2c6iPDlehczKx2oa95QW0SkPPWGuNA/CE8CpyANIhu9XFrj3RQ3EqeRcS
AQQod1RNuHpfETLU/A2gMmvn/w/sx7TB3W5BPs6rprOA37tutPq9u6FTZOcG1Oqj
C/B7yTqgI7rbyvox7DEXoX7rIiEqyNNUguTk/u3SZ4VXE2kmxdmSh3TQvybfbnXV
4JbCZVaqiZraqc7oZMnRoWrXRG3ztbnbes/9qhRGI7PqXqeKJBztxRTEVj8ONs1d
WN5szTwaPIvhkhO3CO5ErU2rVdUr89wKpNXbBODFKRtgxUT70YpmJ46VVaqdAhOZ
D9EUUn4YaeLaS8AjSF/h7UkjOibNc4qVDiPP+rkehFWM66PVnP1Msh93tc+taIfC
EYVMxjh8zNbFuoc7fzvvrFILLe7ifvEIUqSVIC/AzplM/Jxw7buXFeGP1qVCBEHq
391d/9RAfaZ12zkwFsl+IKwE/OZxW8AHa9i1p4GO0YSNuczzEm4=
-----END CERTIFICATE-----`;

const OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const CHAT_URL = 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';
const MODEL = 'GigaChat';
const MAX_MESSAGES = 16;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

let client: Deno.HttpClient | undefined;
try {
  client = Deno.createHttpClient({ caCerts: [RUSSIAN_TRUSTED_ROOT_CA] });
} catch {
  client = undefined;
}
const withClient = (init: RequestInit) => (client ? { ...init, client } : init) as RequestInit;

// Токен GigaChat живёт ~30 минут — храним между вызовами, пока экземпляр функции жив.
let token: { value: string; until: number } | null = null;

async function gigaToken(): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const key = Deno.env.get('GIGACHAT_AUTH_KEY');
  if (!key) throw new Error('no_key');
  const res = await fetch(OAUTH_URL, withClient({
    method: 'POST',
    headers: { Authorization: `Basic ${key.trim()}`, RqUID: crypto.randomUUID(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: 'scope=GIGACHAT_API_PERS',
  }));
  if (!res.ok) throw new Error(`oauth_${res.status}`);
  const data = await res.json();
  token = { value: data.access_token, until: Number(data.expires_at) || Date.now() + 25 * 60_000 };
  return token.value;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);

  // 1. Кто спрашивает
  const auth = req.headers.get('Authorization') ?? '';
  const apikey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  let email: string | undefined;
  try {
    const u = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, { headers: { Authorization: auth, apikey } });
    if (u.ok) email = String((await u.json()).email ?? '').toLowerCase() || undefined;
  } catch {
    email = undefined;
  }
  if (!email) return json({ ok: false, error: 'auth', message: 'Войдите в приложение' }, 401);
  const allowed = (Deno.env.get('ASSISTANT_ALLOWED_EMAILS') ?? '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(email)) return json({ ok: false, error: 'not_allowed', message: 'Помощник не включён для этого аккаунта' }, 403);

  // 2. Что спрашивают
  let body: { messages?: unknown[]; functions?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_json' }, 400);
  }
  const messages = Array.isArray(body.messages) ? body.messages.slice(-MAX_MESSAGES) : [];
  if (messages.length === 0) return json({ ok: false, error: 'empty' }, 400);

  // 3. Ответ GigaChat
  try {
    const access = await gigaToken();
    const res = await fetch(CHAT_URL, withClient({
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, functions: body.functions ?? [], function_call: 'auto', temperature: 0.3 }),
    }));
    if (res.status === 401) token = null;
    if (!res.ok) {
      const text = await res.text();
      const limit = res.status === 402 || res.status === 429 || /limit|quota|payment/i.test(text);
      return json({ ok: false, error: limit ? 'limit' : 'upstream', status: res.status }, 502);
    }
    const data = await res.json();
    const msg = data.choices?.[0]?.message ?? {};
    return json({ ok: true, message: { content: msg.content ?? '', function_call: msg.function_call ?? null }, usage: data.usage });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e).startsWith('no_key') ? 'no_key' : 'network' }, 502);
  }
});
