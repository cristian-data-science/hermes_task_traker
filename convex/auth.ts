import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";

/**
 * Configuración de autenticación con Convex Auth.
 *
 * Provider activo:
 *  - Password: cubre email + contraseña Y email mágico (código por correo),
 *    sin configuración extra. Funciona out-of-the-box en el plan gratuito.
 *
 * Para añadir Google OAuth más adelante:
 *   1. Configurar el provider en el dashboard de Convex Auth (URL de tu app).
 *   2. Crear credenciales OAuth en Google Cloud Console.
 *   3. Importar el provider de Google y añadirlo al array `providers`.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
});
