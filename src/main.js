const AWS = require("aws-sdk");
const ec2 = new AWS.EC2();

const numBackupsToRetain = 2; // The Number Of AMI Backups You Wish To Retain For Each EC2 Instance.
const instancesToBackupTagName = "BackupAMI"; // Tag Key Attached To Instances You Want AMI Backups Of. Tag Value Should Be Set To "Yes".
const imageBackupTagName = "ScheduledAMIBackup"; // Tag Key Attached To AMIs Created By This Process. This Process Will Set Tag Value To "True".
const imageBackupInstanceIdentifierTagName = "ScheduledAMIInstanceId"; // Tag Key Attached To AMIs Created By This Process. This Process Will Set Tag Value To The Instance ID.
const deleteSnaphots = true; // True if you want to delete snapshots during cleanup. False if you want to only delete AMI, and leave snapshots intact.

const createImage = function (instanceId) {
	console.log("Found Instance: " + instanceId);
	const createImageParams = {
		InstanceId: instanceId,
		Name: "AMI Scheduled Backup I(" + instanceId + ") T(" + new Date().getTime() + ")",
		Description: "AMI Scheduled Backup for Instance (" + instanceId + ")",
		NoReboot: true,
		DryRun: false
	};
	ec2.createImage(createImageParams, function (err, data) {
		if (err) {
			console.log("Failure creating image request for Instance: " + instanceId);
			console.log(err, err.stack);
		}
		else {
			const imageId = data.ImageId;
			console.log("Success creating image request for Instance: " + instanceId + ". Image: " + imageId);
			const createTagsParams = {
				Resources: [imageId],
				Tags: [{
					Key: "Name",
					Value: "AMI Backup I(" + instanceId + ")"
				},
					{
						Key: imageBackupTagName,
						Value: "True"
					},
					{
						Key: imageBackupInstanceIdentifierTagName,
						Value: instanceId
					}]
			};
			ec2.createTags(createTagsParams, function (err, data) {
				if (err) {
					console.log("Failure tagging Image: " + imageId);
					console.log(err, err.stack);
				}
				else {
					console.log("Success tagging Image: " + imageId);
				}
			});
		}
	});
};
const deleteSnapshot = function (snapshotId) {
	const deleteSnapshotParams = {
		DryRun: false,
		SnapshotId: snapshotId
	};
	ec2.deleteSnapshot(deleteSnapshotParams, function (err, data) {
		if (err) {
			console.log("Failure deleting snapshot. Snapshot: " + snapshotId + ".");
			console.log(err, err.stack);
		}
		else {
			console.log("Success deleting snapshot. Snapshot: " + snapshotId + ".");
		}
	})
};
const deregisterImage = function (imageId, creationDate, blockDeviceMappings) {
	console.log("Found Image: " + imageId + ". Creation Date: " + creationDate);
	const deregisterImageParams = {
		DryRun: false,
		ImageId: imageId
	};
	console.log("Deregistering Image: " + imageId + ". Creation Date: " + creationDate);
	ec2.deregisterImage(deregisterImageParams, function (err, data) {
		if (err) {
			console.log("Failure deregistering image.");
			console.log(err, err.stack);
		}
		else {
			console.log("Success deregistering image.");
			if (deleteSnaphots) {
				for (let p = 0; p < blockDeviceMappings.length; p++) {
					const snapshotId = blockDeviceMappings[p].Ebs.SnapshotId;
					if (snapshotId) {
						deleteSnapshot(snapshotId);
					}
				}
			}
		}
	});
};
const cleanupOldBackups = function () {
	const describeImagesParams = {
		DryRun: false,
		Filters: [{
			Name: "tag:" + imageBackupTagName,
			Values: ["True"]
		}]
	};
	ec2.describeImages(describeImagesParams, function (err, data) {
		if (err) {
			console.log("Failure retrieving images for deletion.");
			console.log(err, err.stack);
		}
		else {
			const images = data.Images;
			const instanceDictionary = {};
			const instances = [];
			for (let i = 0; i < images.length; i++) {
				const currentImage = images[i];
				for (let j = 0; j < currentImage.Tags.length; j++) {
					const currentTag = currentImage.Tags[j];
					if (currentTag.Key === imageBackupInstanceIdentifierTagName) {
						const instanceId = currentTag.Value;
						if (instanceDictionary[instanceId] === null || instanceDictionary[instanceId] === undefined) {
							instanceDictionary[instanceId] = [];
							instances.push(instanceId);
						}
						instanceDictionary[instanceId].push({
							ImageId: currentImage.ImageId,
							CreationDate: currentImage.CreationDate,
							BlockDeviceMappings: currentImage.BlockDeviceMappings
						});
						break;
					}
				}
			}
			for (let t = 0; t < instances.length; t++) {
				const imageInstanceId = instances[t];
				const instanceImages = instanceDictionary[imageInstanceId];
				if (instanceImages.length > numBackupsToRetain) {
					instanceImages.sort(function (a, b) {
						return new Date(b.CreationDate) - new Date(a.CreationDate);
					});
					for (let k = numBackupsToRetain; k < instanceImages.length; k++) {
						const imageId = instanceImages[k].ImageId;
						const creationDate = instanceImages[k].CreationDate;
						const blockDeviceMappings = instanceImages[k].BlockDeviceMappings;
						deregisterImage(imageId, creationDate, blockDeviceMappings);
					}
				}
				else {
					console.log("AMI Backup Cleanup not required for Instance: " + imageInstanceId + ". Not enough backups in window yet.");
				}
			}
		}
	});
};
exports.handler = function (event, context) {
	const describeInstancesParams = {
		DryRun: false,
		Filters: [{
			Name: "tag:" + instancesToBackupTagName,
			Values: ["Yes"]
		}]
	};
	ec2.describeInstances(describeInstancesParams, function (err, data) {
		if (err) {
			console.log("Failure retrieving instances.");
			console.log(err, err.stack);
		}
		else {
			for (let i = 0; i < data.Reservations.length; i++) {
				for (let j = 0; j < data.Reservations[i].Instances.length; j++) {
					const instanceId = data.Reservations[i].Instances[j].InstanceId;
					createImage(instanceId);
				}
			}
		}
	});
	cleanupOldBackups();
};