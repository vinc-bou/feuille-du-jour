# Installe la tâche planifiée « Feuille du jour » pour l'utilisateur courant (aucun droit administrateur requis) :
#  - tous les jours à 00 h 10 : analyse automatique ;
#  - à l'ouverture de session : relance le serveur (surveillance des compositions) et fait l'analyse si elle manque.
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = (Get-Command python).Source
$pyw = Join-Path (Split-Path $py) 'pythonw.exe'
if (-not (Test-Path $pyw)) { $pyw = $py }
$script = Join-Path $dir 'auto.py'

$a1 = New-ScheduledTaskAction -Execute $pyw -Argument "`"$script`"" -WorkingDirectory $dir
$t1 = New-ScheduledTaskTrigger -Daily -At '00:10'
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$p = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Feuille du jour - analyse 00h10' -Action $a1 -Trigger $t1 -Settings $s -Principal $p -Force | Out-Null

$a2 = New-ScheduledTaskAction -Execute $pyw -Argument "`"$script`" --si-besoin" -WorkingDirectory $dir
$t2 = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName 'Feuille du jour - ouverture de session' -Action $a2 -Trigger $t2 -Settings $s -Principal $p -Force | Out-Null

Get-ScheduledTask -TaskName 'Feuille du jour*' | ForEach-Object { "{0} : {1}" -f $_.TaskName, $_.State }
