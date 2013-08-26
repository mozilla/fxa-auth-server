#!/usr/bin/env bash
MYPWD=`pwd`

echo "Setting up mysql"

sudo /sbin/chkconfig mysqld on
sudo /sbin/service mysqld start
echo "CREATE USER 'picl'@'localhost';" | mysql -u root
echo "CREATE DATABASE picl;" | mysql -u root
echo "GRANT ALL ON picl.* TO 'picl'@'localhost';" | mysql -u root

echo "Setting up memcached"

sudo /sbin/chkconfig memcached on
sudo /sbin/service memcached start

echo "Setting up nginx"

sudo /sbin/chkconfig nginx on
sudo /sbin/service nginx start

echo "Setting up elasticsearch"

wget https://download.elasticsearch.org/elasticsearch/elasticsearch/elasticsearch-0.90.3.tar.gz
pushd /home/app
sudo tar zxvf $MYPWD/elasticsearch-0.90.3.tar.gz
sudo chown -R app:app elasticsearch-0.90.3
popd

echo "Setting up kibana"

wget https://github.com/elasticsearch/kibana/archive/master.tar.gz
mv master.tar.gz kibana-master.tar.gz
pushd /usr/share/nginx/html
sudo tar zxvf $MYPWD/kibana-master.tar.gz
popd

echo "Setting up heka"

HEKAFILE=heka-0_4_0-picl-idp-amd64.tar.gz
wget https://people.mozilla.com/~rmiller/heka/$HEKAFILE
pushd /home/app
sudo tar zxvf $MYPWD/$HEKAFILE
sudo chown -R app:app heka-0_4_0-linux-amd64
popd

echo "Installing identity team public keys"

git clone https://github.com/mozilla/identity-pubkeys
cd identity-pubkeys
git checkout b63a19a153f631c949e7f6506ad4bf1f258dda69
cat *.pub >> /home/ec2-user/.ssh/authorized_keys
cd ..
rm -rf identity-pubkeys

echo "Setting up postfix as the mailserver"

sudo alternatives --set mta /usr/sbin/sendmail.postfix

sudo service sendmail stop
sudo chkconfig sendmail off

sudo tee --append /etc/postfix/main.cf << EOF
# This basic configuration sends mail directly.
# It's unlikely to work very well from within EC2.
# You should get some SES credentials and use it as relay host:
#
#    https://gist.github.com/gene1wood/6323301
#
relayhost = 
smtp_sasl_auth_enable = yes
smtp_sasl_security_options = noanonymous
smtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd
smtp_use_tls = yes
smtp_tls_security_level = encrypt
smtp_tls_note_starttls_offer = yes
EOF

# Create placeholder for the SES relay credentials.
sudo tee --append /etc/postfix/sasl_passwd << EOF
email-smtp.us-east-1.amazonaws.com:25 INSERTUSERNAME:INSERTPASSWORD
EOF
sudo /usr/sbin/postmap /etc/postfix/sasl_passwd
 
sudo service postfix start
sudo chkconfig postfix on

echo "Establishing auto-update crontab"

echo "*/5 * * * * /bin/bash -l /home/app/code/scripts/awsbox/auto_update.sh > /dev/null 2> /dev/null" | sudo crontab -u app -

echo "post-create complete!"
