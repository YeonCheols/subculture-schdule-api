import { Controller, Get, Header } from '@nestjs/common';
import { ADMIN_IMPORTS_CSS, ADMIN_IMPORTS_HTML, ADMIN_IMPORTS_JS } from './event-imports-admin-page';

@Controller('admin')
export class EventImportsAdminPageController {
  @Get('imports')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
  page() {
    return ADMIN_IMPORTS_HTML;
  }

  @Get('imports/app.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  script() {
    return ADMIN_IMPORTS_JS;
  }

  @Get('imports/app.css')
  @Header('Content-Type', 'text/css; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  style() {
    return ADMIN_IMPORTS_CSS;
  }
}
