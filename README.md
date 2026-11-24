# غرفة التحكم – AI Automation

صفحة بتتابع منها كل الـ workflows اللي على n8n لايف، وتتحكم فيها:

- **خط الـ Outbound:** المراحل بالترتيب (1 → 6)، ولمبة لكل مرحلة: أخضر لو آخر تشغيل نجح، وأحمر بينبض لو فشل.
- **تشغيلات فشلت:** كل تشغيل فشل جنبه زرار **شغّلها تاني**، بيعيد نفس التشغيل بنفس الداتا.
- **كل الـ Workflows:** لكل واحد switch تشغّله أو توقّفه منه، وفيه بحث وفلتر.
- **آخر التشغيلات:** آخر 40 تشغيل.

الصفحة بتتحدّث لوحدها كل 30 ثانية.

---

## 1) هات الـ API key من n8n

من n8n افتح **Settings → n8n API → Create an API key** وانسخه.

## 2) شغّله على جهازك

محتاج Node.js 20.12 أو أحدث.

```bash
cp .env.example .env      # وبعدين افتح .env وحط الـ API key وباسورد قوي
npm install
npm start
```

افتح http://localhost:3000 وادخل باليوزر والباسورد اللي حطيتهم في `.env`.

## 3) اطلعه production

### على VPS بـ Docker (الأسهل والأرخص)

```bash
# على السيرفر
git clone <repo-بتاعك> && cd n8n-control
cp .env.example .env && nano .env
docker compose up -d --build
```

هيشتغل على port 3000، وبيرجع يقوم لوحده لو السيرفر عمل restart.

**مهم:** حط قدامه HTTPS، لأن الباسورد بيتبعت مع كل request. أسهل طريقة إنك تستخدم Caddy:

```
control.yourdomain.com {
    reverse_proxy localhost:3000
}
```

### أو على Vercel

1. ارفع الكود على GitHub (الـ `.env` مش هيترفع، لأنه في `.gitignore`).
2. من vercel.com اعمل **Add New → Project** واختار الـ repo. Vercel هيعرف لوحده إنه Express.
3. في **Environment Variables** حط: `N8N_URL` و`N8N_API_KEY` و`DASH_USER` و`DASH_PASS` و`N8N_SEND_SECRET`.
4. اضغط **Deploy**. هتاخد رابط `https://….vercel.app` عليه HTTPS جاهز.

أو من الـ terminal: `npx vercel` للتجربة، و`npx vercel --prod` للنسخة النهائية.

الصفحات موجودة في `web/` مش `public/` بقصد، لأن Vercel بينشر أي حاجة في `public/` من غير باسورد.

### أو على Railway / Render

ارفع الكود على GitHub، واعمل منه service جديد. حط متغيرات الـ `.env` في Environment Variables، والـ start command هو `npm start`. الاتنين بيدّوك HTTPS جاهز.

---

## حاجات لازم تعرفها

- الـ API key بيفضل على السيرفر بس، والمتصفح عمره ما بيشوفه.
- **"شغّلها تاني"** بتعيد تشغيل فشل. أما الـ workflow اللي مبني على schedule، فالـ API بتاع n8n ما فيهوش "run now" ليه. لو وقف، شغّله من الـ switch وهيكمّل في معاده الجاي.
- إيقاف workflow بيطلب منك تأكيد الأول.
- كل عملية تشغيل أو إيقاف أو إعادة بتتسجّل في الـ logs بتاعة السيرفر (`docker compose logs -f`).

## عرض الإيميلات وإرسالها

دوس على أي اسم في الصفحة الرئيسية عشان تشوف الإيميل بتاعه. لو لسه مسودة، تقدر تعدّله وتبعته من هنا.

- الإرسال بيعدّي على workflow في n8n اسمه **Control Room – View & Send Draft**. ده لازم يفضل شغّال.
- `N8N_SEND_SECRET` في `.env` لازم يطابق السر اللي في عقدة "Secret OK?" جوه الـ workflow ده.
- الصفحة ما بتمنعش الإرسال، بس بتحذّر لو اتبعت النهارده 20 إيميل أو أكتر، أو لو آخر إيميل اتبعت من أقل من 3 دقايق. الأرقام دي في أول `web/ceo.js` تحت "One email".
- لو الإيميل اتبعت من غير تعديل، بيتبعت هو نفسه من Gmail. لو اتعدّل، بيتبعت إيميل جديد بنفس الشكل واللوجو، والمسودة القديمة بتتمسح.

## الملفات

| الملف | بيعمل إيه |
|---|---|
| `server.js` | السيرفر: الباسورد، والكلام مع n8n API |
| `web/index.html` + `ceo.js` | صفحة المدير: كل نظام بيعمل إيه، ومين ردّ على الإيميلات (من جدول `outbound_leads`) |
| `web/catalog.js` | شرح كل workflow بالعربي البسيط. **لو ضفت workflow جديد ضيف له سطر هنا**، وإلا هيظهر تحت "أدوات داخلية" |
| `web/ops.html` + `app.js` | الصفحة الفنية: تشغيل وإيقاف، وإعادة التشغيلات اللي وقعت |
| `web/style.css` | الشكل للصفحتين |
| `Dockerfile` + `docker-compose.yml` | للـ production |
| `.env.example` | الإعدادات اللي محتاج تملاها |
