// Vercel Edge Middleware - Basic Auth para acceso restringido al panel
// Solo los coordinadores con las credenciales pueden entrar.
// Credenciales en variables de entorno de Vercel: BASIC_AUTH_USER y BASIC_AUTH_PASS

export const config = {
  matcher: '/((?!favicon\\.ico|api/keepalive).*)',
};

export default function middleware(request) {
  const auth = request.headers.get('authorization');
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;

  if (!user || !pass) {
    return new Response('Configuracion de autenticacion incompleta.', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
    });
  }

  const expected = 'Basic ' + btoa(user + ':' + pass);

  if (auth !== expected) {
    return new Response('Acceso restringido. Solo coordinadores.', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Club Kolbe", charset="UTF-8"',
        'Content-Type': 'text/plain; charset=UTF-8',
      },
    });
  }

  // Auth OK: continua con la request
}

