# SUPER REFEREE

Jeu de hockey sur glace en **3D WebGL** jouable dans un navigateur. La caméra suit l'arbitre depuis la troisième personne avec une rotation progressive; un bouton permet aussi de passer en vue aérienne. Les personnages sont des modèles low-poly originaux inspirés des références visuelles fournies : arbitre en maillot rayé et joueurs équipés de casques, protections, patins et crosses. Aucun paquet ni compilation n'est nécessaire : ouvre `index.html` ou lance un serveur statique dans ce dossier (`python3 -m http.server 8000`).

## Jouer

- Déplace ton arbitre avec **WASD** ou les **flèches haut/bas**. Un appui sur les **flèches gauche/droite** le fait tourner; maintiens-les pour continuer à tourner.
- La caméra poursuit ton arbitre et tourne progressivement en troisième personne; utilise **Vue aérienne** pour observer toute la patinoire.
- Observe la patinoire et prends une décision avec les boutons du panneau ou les touches **1 à 5**.
- **Espace** siffle la décision correspondant à l'incident en cours ; sans incident, le jeu continue. **Échap** met le match en pause.
- Utilise **Commandes** pour reconfigurer les touches, **Pause** pour interrompre le match et le sélecteur de maillot pour personnaliser ton arbitre.

La patinoire et les personnages sont rendus en WebGL sans bibliothèque 3D externe. Les joueurs des deux équipes patinent et jouent le palet de façon autonome. L'arbitre assistant suit l'action. Le match comprend trois périodes accélérées, les buts, les arrêts du gardien, les hors-jeu, les dégagements interdits, des pénalités temporaires et l'évaluation des décisions. La précision et les points d'expérience sont conservés dans le stockage local du navigateur.

### Deux infractions différentes

- **Hors-jeu** : un attaquant franchit la ligne bleue de la zone offensive avant le palet.
- **Dégagement interdit** : le palet est tiré depuis la moitié défensive jusqu'au-delà de la ligne de but adverse sans être touché.
