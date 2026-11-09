# Cloudflare Worker dla Decap CMS — twojksiegowy.eu

To jest przygotowanie migracji serwisu OAuth używanego przez Decap CMS. Dotychczasowy projekt Vercel pozostaje aktywny do czasu zakończenia testów i ręcznego przełączenia konfiguracji.

## Zakres

- Tylko provider GitHub (zgodnie z konfiguracją strony).
- Trasy `GET /auth?provider=github`, `GET /callback` i `GET /health`.
- Losowy 256-bitowy parametr `state`, powiązany z przeglądarką przez cookie HttpOnly/Secure/SameSite=Lax.
- Porównanie `state` w callbacku i usunięcie cookie po zakończeniu.
- Redirect URI i dozwolony origin CMS pochodzą z konfiguracji środowiska, a nie z nagłówka Host lub parametru URL.
- Wiadomości popup OAuth są wysyłane wyłącznie do dokładnego originu CMS.
- Brak sekretów w repozytorium i kodzie front-endowym.

## Wymagane zmienne

Ustaw w Cloudflare Worker → Settings → Variables and Secrets:

- `OAUTH_GITHUB_CLIENT_ID` — Client ID testowej GitHub OAuth App.
- `OAUTH_GITHUB_CLIENT_SECRET` — Client Secret testowej aplikacji jako **Secret**.
- `CMS_ORIGIN` — dokładnie `https://www.twojksiegowy.eu`.
- `OAUTH_REDIRECT_URI` — dokładny adres callback Worker, np. `https://twojksiegowy-cms-oauth.<subdomain>.workers.dev/callback`.

Nie wpisuj Client Secret do `wrangler.toml`, GitHub ani kodu źródłowego.

## Uruchomienie lokalne

Wymagany Node.js 20 lub nowszy.

```bash
npm install
npm test
npx wrangler dev
```

Do lokalnego testu ustaw zmienne w lokalnym pliku `.dev.vars` (plik nie może trafić do Git):
```
OAUTH_GITHUB_CLIENT_ID=...
OAUTH_GITHUB_CLIENT_SECRET=...
CMS_ORIGIN=https://www.twojksiegowy.eu
OAUTH_REDIRECT_URI=http://localhost:8787/callback
```

## Konfiguracja testowa GitHub OAuth App

Zalecam osobną, testową GitHub OAuth App, aby nie zmieniać callbacku używanego przez działający Vercel.

Callback URL testowej aplikacji ustaw na:
`https://<worker-test-url>/callback`.

Nie zmieniaj callback URL głównej GitHub OAuth App przed zakończeniem testów i zaplanowaniem przełączenia.

## Test odbiorczy

1. Otworzyć `/health` — odpowiedź `ok`.
2. Otworzyć `/auth?provider=github` — przekierowanie do GitHub i cookie stanu.
3. Zmodyfikować parametr `state` callbacku — żądanie musi zostać odrzucone.
4. Wykonać autoryzację GitHub — popup musi zwrócić token wyłącznie do originu CMS.
5. Zalogować się do `/admin/` na środowisku testowym.
6. Zapisać testowy szkic artykułu i potwierdzić commit w repozytorium.
7. Sprawdzić odmowę dostępu dla nieznanego providera i nieprawidłowego originu.

## Bezpieczne przełączenie

Nie zmieniaj `base_url` w produkcyjnym `src/admin/config.yml`, callback URL głównej GitHub OAuth App ani nie wyłączaj starego Vercel, dopóki testowa instancja nie przejdzie całego testu logowania i zapisu. Zachowaj możliwość powrotu do starego URL.
