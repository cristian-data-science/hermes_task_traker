' Lanza start.cmd SIN ventana (segundo plano). Lo usa la tarea programada
' "Agent Bridge" al iniciar sesión. El log queda en agent-bridge\bridge.log.
CreateObject("Wscript.Shell").Run """C:\Users\patag\git_provisorio\hermes_task_traker\agent-bridge\start.cmd""", 0, False
