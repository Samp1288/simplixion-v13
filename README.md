# API de synchronisation facultative

Cette API Cloudflare Worker ne gère aucun compte et n’envoie aucun courriel. Elle reçoit seulement un espace anonyme, un jeton technique et une copie chiffrée par le navigateur.

## Prérequis

- Un compte Cloudflare gratuit.
- Node.js installé.
- Wrangler : `npm install -g wrangler`.

## Création de la base D1

Depuis ce dossier :

```bash
wrangler login
wrangler d1 create simplixion-sync
```

Copie le `database_id` retourné dans `wrangler.toml`, à la place de `REMPLACER_PAR_L_ID_D1`.

Initialise le schéma :

```bash
wrangler d1 execute simplixion-sync --remote --file=schema.sql
```

Déploie l’API :

```bash
wrangler deploy
```

Wrangler donnera une adresse ressemblant à `https://simplixion-sync.ton-compte.workers.dev`.

## Finaliser la connexion

Dans `../config.js`, remplace :

```js
API_BASE_URL: ""
```

par :

```js
API_BASE_URL: "https://ap-budget-sync.ton-compte.workers.dev"
```

Puis redéploie l’interface Pages.

## Sécurité de production

Après avoir obtenu l’URL Pages, remplace `ALLOWED_ORIGIN = "*"` dans `wrangler.toml` par l’URL exacte de l’application, puis exécute :

```bash
wrangler deploy
```

Le code d’association doit être gardé privé. Une personne qui possède ce code peut accéder à l’espace associé. Le contenu envoyé au serveur est chiffré côté navigateur, mais la sécurité dépend aussi de la protection du code.
