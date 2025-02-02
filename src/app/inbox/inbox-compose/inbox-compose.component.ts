import { Component, OnInit, Output, Input, EventEmitter } from '@angular/core';
import { Mail } from 'src/app/models/mail';
import { OutboundMail } from 'src/app/models/outbound-mail';
import { MailchainService } from 'src/app/services/mailchain/mailchain.service';
import { SendService } from 'src/app/services/mailchain/messages/send.service';
import { PublicKeyService } from 'src/app/services/mailchain/public-key/public-key.service';
import { AddressesService } from 'src/app/services/mailchain/addresses/addresses.service';
import { NameserviceService } from 'src/app/services/mailchain/nameservice/nameservice.service';
import { Subject, of, Observable } from 'rxjs';

import { debounceTime, distinctUntilChanged, mergeMap } from "rxjs/operators";
import { BsModalService, BsModalRef } from 'ngx-bootstrap/modal';
import { ModalConnectivityErrorComponent } from 'src/app/modals/modal-connectivity-error/modal-connectivity-error.component';

@Component({
  selector: '[inbox-compose]',
  templateUrl: './inbox-compose.component.html',
  styleUrls: ['./inbox-compose.component.scss']
})

export class InboxComposeComponent implements OnInit {
  @Input() currentAccount: string;
  @Input() currentNetwork: string;
  @Input() currentProtocol: string;
  @Input() currentMessage: any;
  
  @Output() openMessage = new EventEmitter();
  @Output() goToInboxMessages = new EventEmitter();
  
  public model = new Mail()
  public fromAddresses: Array<any> = []
  public sendMessagesDisabled: boolean = false;
  private subscription
  public currentRecipientValue

  private recipientAddressChanged = new Subject<string>();
  public recipientLoadingIcon = ""
  public recipientLoadingText = ""
  public messageToField = ""

  public errorTitle: string = ""
  public errorMessage: string = ""
  public modalConnectivityError: BsModalRef;


  constructor(
    private mailchainService: MailchainService,
    private sendService : SendService,
    private publicKeyService: PublicKeyService,
    private addressesService: AddressesService,
    private nameserviceService: NameserviceService,
    private modalService: BsModalService,
  ) { }

  /**
   * Initialize empty values for the message model
   */
  private initMail() {
    this.model.to = ""
    this.model.from = ""
    this.model.subject = ""
    this.model.body = ""

  }

  /**
   * Sets the available from addresses
   */
  private async setFromAddressList(){
    this.fromAddresses = await this.addressesService.getAddresses();
  }

  /**
   * Returns the identicon for the an address
   * @param address the address 
   */
  public generateIdenticon(address) {    
    let icon = this.mailchainService.generateIdenticon(address);
    
    return icon == "" ? "assets/question-circle-regular.svg" : icon
  }

  /**
   * Resolves the recipient field to ENS address
   * (or validates public address).
   * Leverages debounce (in case of user still typing).
   *  
   * @param event the event from keyup
   */
  public recipientResolve(event){
    if (event.target.value == "") {
      this.setRecipientLoadingIcon("clear")
      this.setRecipientLoadingText()
      this.resetModelToField()
    } else if (this.currentRecipientValue != event.target.value) {
      this.setRecipientLoadingIcon("loading")
      this.setRecipientLoadingText()
      this.resetModelToField()
    }
    this.currentRecipientValue = event.target.value
    this.recipientAddressChanged.next(event.target.value);
  }

  /**
   * Sets the recipientLoadingIcon to the following:
   * loading: spinner
   * valid:   tick
   * invalid: cross
   * clear:   blank
   * @param status ['loading' | 'valid' | 'invalid' | 'clear' ]
   */
  public setRecipientLoadingIcon(status) {
    switch (status) {
      case 'loading':
        this.recipientLoadingIcon = "fa fa-spinner fa-pulse"
        break;
      case 'valid':
        this.recipientLoadingIcon = "fa fa-check-circle text-success"
        break;
      case 'invalid':
        this.recipientLoadingIcon = "fa fa-times-circle text-danger"
        break;        
      case 'clear':
        this.recipientLoadingIcon = ""
        break;
    }
  }
  
  /**
   * Sets the recipientLoadingText to the input text
   * @param text the text to display; if blank, clears text
   */
  public setRecipientLoadingText(text: string = "") {
    this.recipientLoadingText = text
  }

  /**
   * Sets up a subscription to handle user entering an ENS name or Ethereum address in the To field.
   * Includes debounce handling and will validate a name or address.
   */
  private setupRecipientAddressLookupSubscription(){
    this.subscription = this.recipientAddressChanged.pipe(
      debounceTime(1500),
      distinctUntilChanged(),
      mergeMap(searchVal => {
        return this.resolveAddress(searchVal)
      } )
    ).subscribe((res) => {
      res.subscribe(val => {
        let address = val['body']['address']
        if ( this.mailchainService.validateEthAddress(address) ) {
          this.model.to = address
          this.setRecipientLoadingIcon('valid')
          this.setRecipientLoadingText('valid address')
        } else {
          this.setRecipientLoadingIcon('invalid')
          this.setRecipientLoadingText('invalid address')
        }
        
      }, err => {
        this.setRecipientLoadingIcon('invalid')
        this.setRecipientLoadingText(err['error']['message'])
      })
    })
  };

  /**
   * resetModelToField resets the to field in the model
   */
  public resetModelToField() {
    this.model.to = ""
  }

  /**
   * Determines whether an address is:
   * * a public address,
   * * an ENS address
   * 
   * Returns observable with body containing address, e,g.
   * {body: {address: "0x1234567891234567891234567891234567891234"} }
   */
  public async resolveAddress(value){
    let returnObs
    
    if ( this.mailchainService.validateEnsName(value) ) {
      returnObs = this.nameserviceService.resolveName(
        this.currentProtocol,
        this.currentNetwork,
        value
      )
    } else if ( this.mailchainService.validateEthAddress(value) ) {
      returnObs = of(
        { body: { address: value} }
      )
    } else {
      returnObs = of(
        { body: { address: ''} }
      )
    }

    return returnObs

  }

  /**
   * Go back to the inbox-messages view
   */
  public returnToInboxMessages(): void {
    this.goToInboxMessages.emit('');
  }

  /**
   * If there is a currentMessage, call the openMessage.emit to go back to the inbox-messages view; Otherwise, call the functin to return to inbox view
   */
  public returnToMessage(): void {
    if (this.currentMessage == undefined) {
      this.returnToInboxMessages();
    } else {
      this.openMessage.emit(this.currentMessage);
    }
  }

  /**
   * Surpress propagation of events to extensions etc.
   */
  public supressEnterPropagation($event: KeyboardEvent): void {
    $event.stopPropagation()
  }
  
  /**
   * Sets the currentAccount as the address in the `from` dropdown
   * -or-
   * When replying, sets the from address as the address the message was sent to
   */
  private setCurrentAccountInFromAddressDropdown(){
    if ( this.currentAccount != undefined ) {
      this.model.from = this.currentAccount
    } 
  }

  /**
   * Initialise the message.
   * If it's a new message, fields will be blank.
   * -or-
   * If it's a reply, the correct fields are mapped to build the response.
   */
  async ngOnInit(): Promise<void> {
    await this.setFromAddressList()
    this.initMail()
    this.setCurrentAccountInFromAddressDropdown()
    this.handleReplyFields()
    this.setupRecipientAddressLookupSubscription()
  }

  /**
   * Set the fields for a reply
   */
  private handleReplyFields(){
    if ( this.currentMessage && this.currentMessage.headers ) {

      var messageFrom:  string = "",
      messageReplyTo:   string = "",
      messageDate:      string = "",
      messageTo:        string = "",
      messageSubject:   string = "",
      messageBody:      string = ""

      if (this.currentMessage.headers["from"]) {
        messageFrom = '\r\n\r\n>From: ' + this.currentMessage.headers["from"] + "\r\n"
      }
      if (this.currentMessage.headers["reply-to"]){
        messageReplyTo = '>Reply To: ' + this.currentMessage.headers["reply-to"] + "\r\n"
      }
      if (this.currentMessage.headers["date"]){
        messageDate = '>Date: ' + this.currentMessage.headers["date"] + "\r\n"
      }
      if (this.currentMessage.headers["to"]){
        messageTo = '>To: ' + this.currentMessage.headers["to"] + "\r\n"
      }
      if (this.currentMessage["subject"]){
        messageSubject = '>Subject: ' + this.currentMessage["subject"] + "\r\n" + ">" + "\r\n"
      } else {
        messageSubject = ""
      }
      if (this.currentMessage["body"]){
        messageBody = '>' + this.currentMessage["body"] 
      }
      
      var messageBody = messageBody.replace(/\r\n/g, '\r\n>');
      
      this.model.body =  messageFrom +
        messageReplyTo +
        messageDate +
        messageTo +
        messageSubject +
        messageBody
      
      this.model.to = this.mailchainService.parseAddressFromMailchain(this.currentMessage.headers["from"])
      this.messageToField = this.currentRecipientValue = this.model.to

      this.model.from = this.mailchainService.parseAddressFromMailchain(this.currentMessage.headers["to"])
      this.model.subject = this.addRePrefixToSubject(this.currentMessage["subject"])
    } 
  }

  /**
   * Checks for 'Re: ' on the subject and adds it if it is not there already.
   * @param subject the message subject
   */
  private addRePrefixToSubject(subject: string) {    
    if (subject.startsWith("Re: ") ) {
      return subject
    } else {
      return "Re: " + subject
    }
  };
  
  /**
  * onSubmit sends email to the local service. It includes the reset form to handle errors and resets.
  */
  public onSubmit() {  
    this.sendMessagesDisabled = true
    var self = this
    
    this.publicKeyService.getPublicKeyFromAddress(
      this.model.to,
      this.currentNetwork
    ).subscribe(res => {

      this.model.publicKey = res["body"]["public_key"]
      var outboundMail = this.generateMessage(this.model)

      this.sendMessage(outboundMail).subscribe(res => {
        self.initMail();
        self.returnToInboxMessages();
      },
      err => {
        this.handleErrorOnPage(
          `Error Code: ${err["error"]["code"]}`,
          `<p>${err["error"]["message"]}</p><p>Please visit <a href="https://docs.mailchain.xyz/troubleshooting/common-inbox-errors" target="_blank">Docs: common inbox errors</a> to see how to fix this.</p>`,
        )
      });
    })
  }

  /**
   * Builds the OutboundMail object for sending
   * @param mailObj The form Mail object
   */
  private generateMessage(mailObj: Mail): OutboundMail {
    return this.mailchainService.generateMail(mailObj)    
  }

  /**
   * Sends the OutboundMail object on the currently selected network
   * @param outboundMail The OutboundMail object
   */
  private sendMessage(outboundMail: OutboundMail) {    
    let network = this.currentNetwork
    
    return this.sendService.sendMail(outboundMail, network)    
  }

    /**
   * handleErrorOnPage
   */
  public handleErrorOnPage(errorTitle, errorMessage) {

    if (this.errorTitle.length == 0 && this.errorMessage.length == 0 ) {
      this.errorTitle = errorTitle
      this.errorMessage = errorMessage
      
      const initialState = {
        errorTitle: errorTitle,
        errorMessage: errorMessage,
      };
      
      this.modalConnectivityError = this.modalService.show(ModalConnectivityErrorComponent, {initialState});
      this.modalConnectivityError.content.closeBtnName = 'Close'
    }
  }
}

