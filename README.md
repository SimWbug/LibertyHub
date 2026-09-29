# Liberty Hub

Service d'amis / invitations / skins pour Liberty Launcher (GTA IV).

## Installation CasaOS
1. CasaOS > "+" > Installer une application personnalisée > Importer
2. Colle `docker-compose.yml` (TONPSEUDO remplacé par ton pseudo GitHub en minuscules)
3. Test : http://IP-DU-NAS:8787/api/health

Les données (comptes, amis) sont dans `/DATA/AppData/liberty-hub/hub.json` sur le NAS.

## Mise à jour
Modifie `server.js` sur GitHub : l'image est reconstruite automatiquement (onglet Actions).
Puis dans CasaOS, mets à jour / redémarre l'app pour récupérer la nouvelle image.
