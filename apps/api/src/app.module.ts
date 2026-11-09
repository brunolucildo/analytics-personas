import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnvironment } from "./config/environment";
import { HealthController } from "./health/health.controller";
import { RateLimitModule } from "./modules/rate-limit";
import { EmailModule } from "./modules/email";
import { AuthModule } from "./modules/auth";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env", ".env"],
      validate: validateEnvironment,
    }),
    RateLimitModule,
    EmailModule,
    AuthModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
