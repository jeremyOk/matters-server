import sgMail from '@sendgrid/mail'
import { MailData } from '@sendgrid/helpers/classes/mail'

import { environment, isDev, isTest } from 'common/environment'

class MailService {
  mail: typeof sgMail

  constructor() {
    this.mail = this._setupSgMail()
  }

  _setupSgMail = () => {
    sgMail.setApiKey(environment.sgKey as string)
    return sgMail
  }

  send = async (params: MailData) => {
    if (isTest) {
      return
    }

    await this.mail.send({
      ...params,
      mailSettings: {
        sandboxMode: {
          enable: isDev
        }
      }
    })
  }
}

export const mailService = new MailService()