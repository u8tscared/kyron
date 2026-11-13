# KYRON — activer les vrais comptes en ligne (Supabase)

Ce guide est pour toi, Marceau, sans connaissances techniques. Compte 15 minutes.

**Ce que ça change.** Sans Supabase, KYRON fonctionne en « mode local » : chaque testeur crée un compte qui n'existe que dans son navigateur, sur son appareil. S'il change de téléphone ou vide son navigateur, il perd tout. Avec Supabase, les comptes, les séances et les vidéos sont gardés en ligne : un testeur se connecte depuis n'importe quel appareil et retrouve tout.

**Supabase**, c'est un service en ligne qui fournit une base de données, des comptes utilisateurs et un stockage de fichiers. L'offre gratuite suffit pour démarrer.

> Le projet KYRON existe déjà (adresse `https://dhomehxseunhckifdbiv.supabase.co`) et il est déjà branché dans `app/config.js`. Si c'est ton cas, passe directement à l'étape 3. Les étapes 1 et 2 servent si tu dois un jour recréer un projet.

---

## Étape 1 — Créer un compte Supabase

1. Va sur **https://supabase.com** et clique sur **Start your project**.
2. Inscris-toi (le plus simple : **Continue with GitHub**, ou avec ton email).

## Étape 2 — Créer le projet

1. Clique sur **New project**.
2. **Name** : `kyron`.
3. **Database Password** : clique sur **Generate a password** et garde-le dans un endroit sûr (tu n'en auras normalement pas besoin, l'app ne l'utilise pas).
4. **Region** : choisis **Europe (Paris ou Frankfurt)**, plus rapide pour des testeurs en France.
5. Offre : **Free**. Clique sur **Create new project**, puis attends une à deux minutes.

## Étape 3 — Préparer la base (copier-coller le script)

1. Dans le menu de gauche, ouvre **SQL Editor**.
2. Clique sur **New query**.
3. Ouvre le fichier `docs/supabase-setup.sql` du projet KYRON, copie **tout** son contenu et colle-le dans l'éditeur.
4. Clique sur **Run** (en bas à droite). Le message attendu : *Success. No rows returned*.

Ce script crée deux tables (profils et séances), un espace privé `videos` pour les fichiers, et surtout les **règles de sécurité** : chaque utilisateur ne voit que ses propres données. Tu peux le relancer sans risque, il ne casse rien et ne crée pas de doublon.

Pour vérifier : menu **Table Editor**, tu dois voir `profiles` et `sessions` ; menu **Storage**, tu dois voir `videos` (marqué *Private*).

## Étape 4 — Choisir si l'email doit être confirmé

Par défaut, Supabase envoie un email de confirmation à chaque inscription : le testeur doit cliquer sur le lien avant de pouvoir se connecter.

- **Pour tester vite** : menu **Authentication** → **Sign In / Providers** → section **Email** → décoche **Confirm email** → **Save**. L'inscription connecte alors directement.
  - *Contrepartie* : n'importe qui peut créer un compte avec une adresse qui n'est pas la sienne (ou une faute de frappe), et « Mot de passe oublié » ne marchera pas pour une adresse mal saisie.
- **Pour une vraie ouverture au public** : laisse **Confirm email** coché. Attention, l'offre gratuite n'envoie que quelques emails par heure (environ 2 à 4) ; au-delà, il faut brancher un service d'envoi d'emails (menu **Authentication** → **Emails** → **SMTP Settings**, par exemple avec Brevo ou Resend).

Dans les deux cas, indique l'adresse de l'app pour que les liens des emails (confirmation, mot de passe oublié) ramènent au bon endroit : **Authentication** → **URL Configuration** → **Site URL** = l'adresse où KYRON est publié (par exemple `https://ton-nom.github.io/kyron/app/`), et ajoute-la aussi dans **Redirect URLs**.

## Étape 5 — Taille des vidéos

L'offre gratuite limite chaque fichier à **50 Mo**. Une vidéo de téléphone d'une minute en 1080p fait souvent 100 à 200 Mo.

- Avec l'offre gratuite : les analyses sont toujours enregistrées, mais une vidéo de plus de 50 Mo est refusée par le serveur ; l'app le dit clairement (« Analyse enregistrée, mais sans la vidéo… »). Conseil aux testeurs : clips courts (10 à 20 secondes) en 1080p.
- Avec l'offre **Pro** (environ 25 $ par mois) : menu **Project Settings** → **Storage** → **Upload file size limit** → mets **300 MB**. C'est aussi la limite que l'app applique de son côté.

## Étape 6 — Récupérer les deux codes du projet

1. Menu **Project Settings** (roue dentée) → **Data API** (ou **API Keys**).
2. Copie :
   - **Project URL** (ressemble à `https://abcdefghijkl.supabase.co`) ;
   - la clé **anon public** (une longue suite de caractères qui commence par `eyJ…`).
3. Envoie ces deux valeurs à Claude, ou colle-les toi-même dans `app/config.js` :

```js
export const SUPABASE = { url: 'https://abcdefghijkl.supabase.co', anonKey: 'eyJ…' };
```

**Ne copie jamais** la clé **service_role** (ou « secret ») : elle donne tous les droits. Elle ne doit jamais apparaître dans l'app.

## Pourquoi la clé « anon » peut être publiée

La clé anon est faite pour être visible dans le code d'une app web : à elle seule, elle ne donne accès à rien. Ce qui protège les données, ce sont les règles « RLS » (*Row Level Security*) installées par le script de l'étape 3 : le serveur vérifie, à chaque lecture ou écriture, que la ligne ou le fichier appartient bien à l'utilisateur connecté. Un visiteur non connecté ne voit rien ; un testeur ne voit que ses propres séances et vidéos.

## Où publier l'app

Les comptes en ligne demandent que l'app puisse parler au serveur Supabase. Ça marche quand KYRON est publié sur **GitHub Pages**, Netlify ou ton propre site. Dans un Artifact claude.ai, les échanges avec un autre site sont bloqués : l'app y reste en mode local.

## En cas de souci

| Message dans l'app | Cause probable | Que faire |
|---|---|---|
| « Le serveur n'est pas prêt… » | Le script SQL n'a pas été lancé | Refaire l'étape 3 |
| « Email pas encore confirmé… » | Confirmation email activée | Cliquer le lien reçu, ou décocher **Confirm email** (étape 4) |
| « Trop de tentatives… » | Limite d'emails ou d'essais atteinte | Attendre, ou brancher un SMTP (étape 4) |
| « Analyse enregistrée, mais sans la vidéo… » | Vidéo > limite du projet | Étape 5 |
| « Pas de connexion au serveur… » | Pas d'internet, ou app publiée dans un Artifact | Vérifier la connexion / publier sur GitHub Pages |

Pour voir les comptes créés : menu **Authentication** → **Users**. Pour supprimer un testeur : clique sur son compte → **Delete user** (ses séances partent avec ; ses vidéos restent dans **Storage** → `videos` → dossier à son identifiant, à supprimer à la main).
