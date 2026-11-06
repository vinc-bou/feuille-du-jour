# Retire les tâches planifiées de la Feuille du jour (l'app elle-même reste utilisable avec Lancer.bat).
Get-ScheduledTask -TaskName 'Feuille du jour*' -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false
"Tâches retirées."
