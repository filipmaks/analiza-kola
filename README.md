# Fudbalski pregled — Windows

Verzija **1.3.0** · izdanje **15.09.2026.**

Desktop aplikacija za Windows 10/11 (64-bit) na srpskoj latinici za H2H analizu fudbalskih utakmica. Ista analiza, isti Flashscore adapter i isti izgled kao macOS verzija. Bez servera i naloga.

## Pokretanje

1. Raspakuj folder `Fudbalski pregled-win32-x64` gde god želiš (npr. `C:\Programi\` ili Desktop). Instalacija nije potrebna.
2. Pokreni **`Fudbalski pregled.exe`**.
3. Pri prvom pokretanju Windows može prikazati „Windows je zaštitio vaš računar” (SmartScreen), jer aplikacija nije digitalno potpisana. Klikni **Više informacija → Ipak pokreni**. To se traži samo jednom.
4. Po želji: desni klik na `Fudbalski pregled.exe` → **Pošalji u → Radna površina (napravi prečicu)**.

Folder mora ostati kompletan: `.exe` ne radi ako se izdvoji iz foldera.

## Korišćenje

- **Skeniraj danas** pronalazi lige koje danas imaju predstojeće utakmice i *dodaje* ih u tvoj izbor. Tvoje lige se nikada ne uklanjaju. Dugme **Koristi samo današnje lige** namerno sužava izbor.
- **Napravi mi dnevni izveštaj** analizira utakmice izabranih liga u naredna 24 sata.
- Preuzimanje je namerno sporo (razmak od 5 sekundi, najviše 300 učitavanja po pokretanju). Za više liga izveštaj može biti **Delimičan**; dugme **Nastavi** nastavlja od mesta gde je stao.
- **Podešavanja → OpenAI obrazloženja**: unesi svoj API ključ i klikni **Sačuvaj i proveri**. Ključ se čuva šifrovano (Windows zaštita podataka vezana za tvoj nalog). Ako izabrani model nije dostupan na tvom nalogu, izaberi drugi sa liste.
- Bez API ključa radi kompletan lokalni proračun i osnovno tekstualno obrazloženje.
- **Izvezi** čuva izveštaj kao Markdown ili JSON. U **Istoriji** se stari izveštaji mogu otvoriti ili obrisati.

## Podaci

Svi podaci ostaju na računaru, u `%APPDATA%\Fudbalski pregled\`:

- `data\reports` — izveštaji, `data\settings` — podešavanja, `data\cache` — keš rezultata (automatski se čisti),
- `secrets\openai.key` — šifrovan API ključ.

Brisanje foldera aplikacije ne briše ove podatke. Za potpuno uklanjanje obriši i `%APPDATA%\Fudbalski pregled`.

Pravila preuzimanja su ista kao na macOS-u: bez pozadinskog rada, pri HTTP 403/429 ili prepoznatoj blokadi obrada se zaustavlja i čeka se najmanje sat. Flashscore ograničava automatizovano preuzimanje bez saglasnosti: https://www.flashscore.com/terms-of-use/.

## Izrada iz izvornog koda

Potrebni su Node.js 22+ i internet za prvu instalaciju paketa. Radi na Windows-u, macOS-u i Linux-u.

```sh
npm install
npm test               # 34 lokalna testa, bez mreže
npm run smoke          # opciono: stvarna provera Flashscore-a (mreža)
npm start              # pokretanje iz koda
npm run package:win    # pravi dist/Fudbalski pregled-win32-x64
```

Struktura:

- `src/core/core.js` — analiza, pravila i parser (port `Sources/FootballCore`), deli se između procesa i testova,
- `src/main/` — učitavanje stranica (skriveni Chromium prozor), Flashscore izvor, OpenAI, skladište, šifrovanje ključa,
- `renderer/` — korisnički interfejs,
- `resources/Flashscore.js` — isti DOM adapter kao u macOS aplikaciji (`npm run sync-adapter` ga kopira iz macOS izvora).

Zastavice na Windows-u prikazuje priloženi font „Twemoji Country Flags” (CC-BY 4.0, vidi `renderer/fonts/NOTICE.txt`).
