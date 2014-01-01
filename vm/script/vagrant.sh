sed -i "s/^.*requiretty/#Defaults requiretty/" /etc/sudoers
sed -i "s/^\(.*env_keep = \"\)/\1PATH /" /etc/sudoers

# Vagrant
date > /etc/vagrant_box_build_time

VAGRANT_USER=vagrant
VAGRANT_HOME=/home/$VAGRANT_USER
VAGRANT_KEY_URL=https://raw.github.com/mitchellh/vagrant/master/keys/vagrant.pub

# Add vagrant user
/usr/sbin/groupadd $VAGRANT_USER
/usr/sbin/useradd $VAGRANT_USER -g $VAGRANT_USER -G wheel
echo "${VAGRANT_USER}"|passwd --stdin $VAGRANT_USER
echo "${VAGRANT_USER} ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

# Installing vagrant keys
mkdir -pm 700 $VAGRANT_HOME/.ssh
wget --no-check-certificate "${VAGRANT_KEY_URL}" -O $VAGRANT_HOME/.ssh/authorized_keys
chmod 0600 $VAGRANT_HOME/.ssh/authorized_keys
chown -R $VAGRANT_USER:$VAGRANT_USER $VAGRANT_HOME/.ssh

# Install guest additions
if [ $PACKER_BUILDER_TYPE == 'vmware' ]; then
    cd /tmp
    mkdir -p /mnt/cdrom
    mount -o loop /root/linux.iso /mnt/cdrom
    tar zxf /mnt/cdrom/VMwareTools-*.tar.gz -C /tmp/
    /tmp/vmware-tools-distrib/vmware-install.pl --default
    rm /root/linux.iso
    umount /mnt/cdrom
    rmdir /mnt/cdrom
elif [ $PACKER_BUILDER_TYPE == 'virtualbox' ]; then
    VBOX_VERSION=$(cat /root/.vbox_version)
    mount -o loop /root/VBoxGuestAdditions_$VBOX_VERSION.iso /mnt
    sh /mnt/VBoxLinuxAdditions.run --nox11
    umount /mnt
    rm -rf /root/VBoxGuestAdditions_$VBOX_VERSION.iso
fi

# Stop udev from blocking the network
rm /etc/udev/rules.d/70-persistent-net.rules
    mkdir /etc/udev/rules.d/70-persistent-net.rules
    rm /lib/udev/rules.d/75-persistent-net-generator.rules
rm -rf /dev/.udev/
sed -i "/^HWADDR/d" /etc/sysconfig/network-scripts/ifcfg-eth0
