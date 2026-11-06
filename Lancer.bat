@echo off
rem Ouvre la Feuille du jour avec son petit serveur local (donnees ouvertes : xG, arbitres, cotes, transferts).
cd /d "%~dp0"
start "" http://localhost:8765/
python serveur.py
