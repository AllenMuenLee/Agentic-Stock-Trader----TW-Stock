import { config } from 'dotenv';
import nodemailer from 'nodemailer';
import { resolve } from 'path';

config({ path: resolve(__dirname, './apps/api/.env') });

const testEmail = async () => {
  const ports = [465, 587];
  
  for (const port of ports) {
    console.log(`\nTesting port ${port}...`);
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: port,
        secure: port === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        connectionTimeout: 10000, // 10 seconds timeout
      });

      const result = await transporter.verify();
      console.log(`Port ${port} verification successful:`, result);
      
      // If verification is successful, try to send an email
      console.log(`Attempting to send email via port ${port}...`);
      const info = await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        to: 'limuen.allen@gmail.com',
        subject: `Test from AI股探 (Port ${port})`,
        text: 'This is a test email.',
      });
      console.log(`Email sent successfully on port ${port}:`, info.messageId);
      break; // Exit if successful
    } catch (err: any) {
      console.error(`Failed on port ${port}:`, err.message);
    }
  }
};

testEmail();
