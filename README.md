# ארכיון החוזים

מערכת RAG לחוזים והסכמים. היא קוראת את כל החוזים מתיקיית Google Drive
`MITVE TOOLS/NECHASIM/CONTRACTS` (כולל PDF סרוקים ותמונות), עונה על שאלות עם הפניה לסעיף ולעמוד,
ומנסחת הסכמים חדשים על בסיס הנוסח שכבר קיים במאגר.

## מה יש במערכת

| מסך | מה עושים בו |
|---|---|
| שאלו את הארכיון | שאלות בשפה חופשית. כל טענה מסומנת בציטוט, והסעיף המקורי מוצג בשוליים |
| חוזים | כל החוזים במאגר, עם צדדים, תאריכים, סכומים וסיכום שחולצו אוטומטית |
| הסכם חדש | טופס קצר, והחוזה נכתב על המסך תוך כדי. אחר כך בדיקה משפטית ותיקון אוטומטי |
| טיוטות | צפייה, עריכה והורדה כקובץ Word |
| סנכרון | סנכרון ידני, היסטוריית ריצות וקבצים שנכשלו |
| עלויות | עלות לפי יום ולפי משימה |

## ארכיטקטורה

```
Google Drive ──(לילי, רק קבצים שהשתנו)──► קליטה: טקסט / OCR ► סעיפים ► embeddings ► Postgres + pgvector
                                                                                     │
Next.js (עברית, RTL) ◄──SSE──► FastAPI ► תיאום בקוד ► סוכני Agno ◄──────────────────┘
```

**סוכנים (Agno):**
- **router:** מבין שאלות המשך.
- **librarian:** עונה עם ציטוטים.
- **web_researcher:** משלים מהאינטרנט רק כשצריך.
- **drafter:** מנסח את החוזה.
- **reviewer:** בודק את הטיוטה.
- **reviser:** מתקן רק את מה שהבודק סימן.
- **metadata:** מחלץ את פרטי החוזה.

התיאום ביניהם נעשה בקוד Python, ולא על ידי סוכן מתאם, כך שלא משלמים טוקנים על החלטות ניתוב.

**חיסכון בטוקנים:**
- הסנכרון הלילי משווה md5 ומעבד רק קבצים שהשתנו. לילה בלי שינויים עולה 0 טוקנים.
- סעיף שלא השתנה שומר את ה-embedding שלו.
- OCR מקומי (Tesseract) קודם, ומודל ראייה רק לעמוד שנכשל.
- חיפוש היברידי (וקטורים + מילות מפתח, RRF) בלי reranker מבוסס LLM.
- נשלחים למודל רק 6 סעיפים, וכל סעיף נחתך ל-700 טוקנים לכל היותר.
- המודל מצטט במספר ([2]) במקום לחזור על שם המסמך.
- שאלות חוזרות נענות מזיכרון. הזיכרון מתאפס כשהמאגר משתנה.
- מודל לפי משימה: מודל זול למשימות קלות, מודל חזק רק לניסוח.
- המנסח כותב בפורמט טקסט ולא ב-JSON, כך שהחוזה מופיע על המסך תוך שניות.
- התיקון שולח רק את הפרקים שהבודק סימן.
- תקציב טוקנים יומי, ומעקב עלות לכל סוכן.

עלויות שנמדדו: תשובה כ-$0.003, טיוטת חוזה מלאה עם בדיקה ותיקון כ-$0.06.

## הרצה מקומית

```bash
cp .env.example .env            # ומלאו את OPENAI_API_KEY
docker compose up -d db

python -m venv .venv && .venv/Scripts/pip install -r backend/requirements.txt
cd backend
../.venv/Scripts/python -m uvicorn app.main:app --port 8000

# בטרמינל נוסף
cd frontend && npm install && npm run dev      # http://localhost:3000
```

אפשר לנסות את המערכת לפני שמחברים את Drive:
`python -m app.jobs.import_local samples`. הפקודה קולטת את שלושת הסכמי הדוגמה מהתיקייה `backend/samples`.

## חיבור Google Drive

1. ב-Google Cloud Console, בפרויקט של ה-Service Account: מפעילים את **Google Drive API**.
2. משתפים את התיקייה `CONTRACTS` עם כתובת ה-Service Account, בהרשאת צפייה בלבד. הכתובת מופיעה במסך "סנכרון".
3. מגדירים את `GOOGLE_DRIVE_FOLDER_ID`. אם הוא ריק, המערכת מאתרת את התיקייה לפי הנתיב.
4. במסך "סנכרון" לוחצים **סנכרון עכשיו**.

## פריסה בחינם: Neon, Render ו-GitHub Actions

| רכיב | איפה | עלות |
|---|---|---|
| מסד נתונים (Postgres + pgvector) | Neon | חינם. הנתונים נשמרים |
| שרת ה-API (Docker עם Tesseract בעברית) ואתר Next.js | Render, `render.yaml` | חינם. השרתים נרדמים אחרי כ-15 דקות בלי שימוש |
| סנכרון לילי | GitHub Actions, `.github/workflows/nightly-sync.yml` | חינם |

**1. Neon**
1. נרשמים ב-https://neon.com ויוצרים פרויקט (Region: Frankfurt).
2. ב-**Connect** מכבים את **Connection pooling** ומעתיקים את ה-connection string. צריך את החיבור הישיר, כי הסנכרון משתמש בנעילה של Postgres.

**2. Render** (בלי כרטיס אשראי)
1. **New > Blueprint**, בוחרים את הריפו ואת הענף.
2. ממלאים את הסודות:
   - `DATABASE_URL`: מ-Neon.
   - `OPENAI_API_KEY`.
   - `GOOGLE_DRIVE_FOLDER_ID`.
   - `APP_PASSWORD`: סיסמת הצוות.
3. ב-`contracts-api`, תחת **Environment**, מוסיפים **Secret File** בשם `service_account.json`.

**3. GitHub Actions** (הסנכרון הלילי)
1. בריפו: **Settings > Secrets and variables > Actions > New repository secret**, ומוסיפים:
   - `DATABASE_URL`.
   - `OPENAI_API_KEY`.
   - `GOOGLE_DRIVE_FOLDER_ID`.
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: מדביקים את כל התוכן של קובץ ה-JSON.
2. הריצה המתוזמנת פועלת רק מהענף `main`, ולכן צריך למזג אליו.
3. כדי לבדוק: **Actions > Nightly contract sync > Run workflow**.

אחרי הסנכרון הראשון פותחים את האתר ונכנסים עם הסיסמה.

גרסה בתשלום, שבה הכול זמין תמיד ונמצא ב-Render, נמצאת ב-`render.paid.yaml`. העלות שלה כ-20$ לחודש.

## בדיקות

```bash
cd backend && ../.venv/Scripts/python -m pytest -q
```
