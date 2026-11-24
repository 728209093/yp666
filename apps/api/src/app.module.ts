import { Module } from '@nestjs/common';
import { AppService } from './app.service.js';
import { AdminController, AdminGuard, AuthController, PublicController } from './app.controller.js';
import { DatabaseService } from './database.service.js';

@Module({controllers:[PublicController,AuthController,AdminController],providers:[AppService,DatabaseService,AdminGuard]})
export class AppModule {}
