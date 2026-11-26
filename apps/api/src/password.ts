import { BadRequestException } from '@nestjs/common';

// bcrypt ignores every byte after the first 72, including part of a UTF-8 character.
export function assertNewPassword(password:string) {
  if(password.length<12||Buffer.byteLength(password,'utf8')>72) {
    throw new BadRequestException('密码至少 12 个字符，且 UTF-8 编码不超过 72 字节');
  }
}
