# Authentication Specification

## Purpose

Acceso por clave RSA (challenge-response, sin contraseña) de uso
unipersonal. La clave privada nunca sale del navegador: solo firma
challenges; el backend verifica contra la clave pública y emite tokens de
sesión.

## Requirements

### Requirement: Login RSA challenge-response
El sistema SHALL autenticar así: (1) el cliente pide un challenge (nonce de
un solo uso, 60 s de vida); (2) importa la clave privada PKCS#8 con Web
Crypto DENTRO del navegador y firma el challenge (RSASSA-PKCS1-v1_5 +
SHA-256); (3) el backend verifica la firma con `HERMES_RSA_PUBLIC_KEY`
(secreto de Convex) y emite un token de sesión.

#### Scenario: Login con rsa_key.p8
- **WHEN** se arrastra la clave privada válida a la pantalla de login
- **THEN** el challenge se firma localmente, el backend lo valida y se
  entra al dashboard sin que la clave viaje jamás

#### Scenario: Challenge reusado o expirado
- **WHEN** se intenta firmar un challenge ya usado o con más de 60 s
- **THEN** el login se rechaza

### Requirement: Pantalla de login
El sistema SHALL ofrecer una zona drag-and-drop que también es
click-para-seleccionar (acepta .p8/.pem/.key), con spinner "Verificando
clave…" y mensajes de error claros.

#### Scenario: Archivo inválido
- **WHEN** se suelta un archivo que no es la clave
- **THEN** se muestra el error y se puede reintentar sin recargar

### Requirement: Sesiones
El sistema SHALL emitir tokens de sesión de 32 bytes con 30 días de vida,
persistidos en `localStorage["hermes-session-token"]` (persisten en el
navegador habitual, no en incógnito). La validez se confirma reactivamente
(`authQuery.verifySession`); un token inválido/expirado se limpia y las
queries usan "skip" hasta validar, sin romper la UI.

#### Scenario: Token expirado al abrir la app
- **WHEN** el token guardado ya caducó
- **THEN** se limpia silenciosamente y aparece la pantalla de login

### Requirement: Logout
El sistema SHALL invalidar la sesión en backend (`signOut`) y limpiar el
estado local al cerrar sesión.

#### Scenario: Cerrar sesión
- **WHEN** se pulsa salir en la Toolbar
- **THEN** el token se invalida en el servidor y se borra localmente
